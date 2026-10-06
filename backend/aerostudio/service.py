"""Prediction service: design -> morphed mesh -> surrogate -> post-processing -> wire format."""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from aerostudio import postproc
from aerostudio.api import schemas as S
from aerostudio.meshing.library import MeshService, PreparedMesh

SOUND_SPEED = 346.1  # m/s at 298.15 K (AirfRANS reference temperature)

# Nominal AirfRANS sampling ranges, used only when the checkpoint's stats carry no envelope.
FALLBACK_RANGES = {
    "u_inf": (31.0, 94.0), "aoa_deg": (-5.0, 15.0), "camber_param": (0.0, 7.0),
    "camber_pos": (0.0, 8.0), "thickness": (5.0, 20.0),
}


class Engine(Protocol):
    nu: float
    chord: float

    @property
    def info(self) -> dict: ...

    @property
    def stats_meta(self) -> dict: ...

    def infer(self, x: np.ndarray, edge_index: np.ndarray, edge_attr: np.ndarray, with_checks: bool = True): ...


@dataclass
class StoredResult:
    mesh: PreparedMesh
    x: np.ndarray
    fields: np.ndarray
    prediction: "S.Prediction"


class PredictionService:
    def __init__(self, engine: Engine, meshes: MeshService, result_cache_size: int = 32):
        self.engine = engine
        self.meshes = meshes
        self._results: OrderedDict[str, StoredResult] = OrderedDict()
        self._size = result_cache_size
        self._lock = threading.Lock()
        self._inflight: dict[str, threading.Event] = {}
        self.model_version = self._model_version()

    # ------------------------------------------------------------------ metadata
    def _model_version(self) -> str:
        info = self.engine.info
        ck = info.get("checkpoints") or ["?"]
        run = "+".join(sorted({str(c).replace("\\", "/").rstrip("/").split("/")[-2] for c in ck if "/" in str(c).replace("\\", "/")})) or "model"
        return f"{run}@{str(info.get('surrogate_commit', ''))[:7]}"

    def envelope_ranges(self) -> tuple[dict, bool]:
        """{param: (min, max)} of the training split, and whether they are provisional."""
        env = (self.engine.stats_meta.get("input_ranges") or {}).get("envelope")
        if not env:
            return dict(FALLBACK_RANGES), True
        return {n: (lo, hi) for n, lo, hi in zip(env["param_names"], env["min"], env["max"])}, False

    def envelope(self) -> S.Envelope:
        env = (self.engine.stats_meta.get("input_ranges") or {}).get("envelope")
        R = lambda lo, hi, step: S.EnvelopeRange(min=round(lo, 3), max=round(hi, 3), step=step)  # noqa: E731
        if env:
            pts = np.asarray(env["points"])
            names = env["param_names"]
            col = {n: i for i, n in enumerate(names)}

            def fam(is5: int, name: str, fallback):
                sel = pts[pts[:, col["is_5digit"]] == is5]
                if not len(sel):
                    return R(*fallback, 0.1)
                return R(float(sel[:, col[name]].min()), float(sel[:, col[name]].max()), 0.1)

            f = FALLBACK_RANGES
            return S.Envelope(
                naca4={"M": fam(0, "camber_param", (0, 7)), "P": fam(0, "camber_pos", (0, 7)), "T": fam(0, "thickness", f["thickness"])},
                naca5={"L": fam(1, "camber_param", (0, 4)), "P": fam(1, "camber_pos", (3, 8)), "T": fam(1, "thickness", f["thickness"])},
                aoa=R(env["min"][col["aoa_deg"]], env["max"][col["aoa_deg"]], 0.1),
                speed=R(env["min"][col["u_inf"]], env["max"][col["u_inf"]], 0.5),
                provisional=False,
            )
        f = FALLBACK_RANGES
        return S.Envelope(
            naca4={"M": R(0, 7, 0.1), "P": R(0, 7, 0.1), "T": R(*f["thickness"], 0.1)},
            naca5={"L": R(0, 4, 0.1), "P": R(3, 8, 0.1), "T": R(*f["thickness"], 0.1)},
            aoa=R(*f["aoa_deg"], 0.1), speed=R(*f["u_inf"], 0.5), provisional=True,
        )

    # ------------------------------------------------------------------ checks
    def envelope_checks(self, design: S.Design, engine_warnings: list[str]) -> list[S.EnvelopeCheck]:
        ranges, _ = self.envelope_ranges()
        p = design.params()
        is5 = p.family == "5"
        rows = [
            ("camber_param", "L" if is5 else "M", "Design lift L" if is5 else "Max camber M", p.L if is5 else p.M),
            ("camber_pos", "P", "Camber position P", p.P),
            ("thickness", "T", "Thickness T", p.T),
            ("aoa_deg", "aoa", "Angle of attack", design.aoa),
            ("u_inf", "speed", "Inflow speed", design.speed),
        ]
        out = []
        for name, key, label, value in rows:
            lo, hi = ranges.get(name, (value, value))
            margin = 0.03 * (hi - lo)
            if value < lo - 1e-6 or value > hi + 1e-6:
                status, msg = "fail", "Outside the training range; the prediction is an extrapolation."
            elif value < lo + margin or value > hi - margin:
                status, msg = "warn", "Near the edge of the training range; expect higher error."
            else:
                status, msg = "pass", None
            out.append(S.EnvelopeCheck(key=key, label=label, value=value, min=lo, max=hi, status=status, message=msg))
        combo = [w for w in engine_warnings if w.startswith("nearest training case")]
        env = (self.engine.stats_meta.get("input_ranges") or {}).get("envelope")
        if env:
            out.append(S.EnvelopeCheck(
                key="combo", label="Parameter combination", value=0.0, min=0.0, max=float(env["nn_threshold"]),
                status="fail" if combo else "pass", message=combo[0] if combo else None,
            ))
        return out

    def mesh_info(self, mesh: PreparedMesh, engine_warnings: list[str]) -> S.MeshMorphInfo:
        r = mesh.report
        mesh_warn = [w for w in engine_warnings if w.startswith("mesh ")]
        status = "fail" if not r.ok else ("warn" if mesh_warn else "pass")
        msgs = ([r.message] if r.message and not r.ok else []) + mesh_warn
        return S.MeshMorphInfo(
            base_case=mesh.base_id, shape_distance=round(mesh.shape_distance, 4),
            max_surface_displacement=r.max_surface_displacement, min_cell_quality=r.min_scaled_jacobian,
            nodes=int(mesh.x.shape[0]), status=status, messages=msgs,
        )

    # ------------------------------------------------------------------ inference
    def result_id(self, design: S.Design) -> str:
        blob = json.dumps(design.model_dump(mode="json"), sort_keys=True) + self.model_version
        return hashlib.sha1(blob.encode()).hexdigest()[:12]

    def _run(self, design: S.Design, with_checks: bool = True):
        mesh = self.meshes.get(design.params())
        x = mesh.with_inflow(design.aoa, design.speed)
        inf = self.engine.infer(x, mesh.edge_index, mesh.edge_attr, with_checks=with_checks)
        return mesh, x, inf

    def coefficients(self, design: S.Design) -> dict:
        """Hot path for sweeps and the optimizer: coefficients only."""
        mesh, x, inf = self._run(design, with_checks=False)
        c, s = inf.coeffs, inf.coeffs_std
        cd = max(c["cd"], 1e-6)
        ld = c["cl"] / cd
        ld_sigma = abs(ld) * math.hypot(s["cl"] / max(abs(c["cl"]), 1e-3), s["cd"] / cd)
        sep = postproc.separated_fraction(mesh, inf.fields)
        return {
            "cl": c["cl"], "cd": c["cd"], "cm": postproc.pitching_moment(mesh, x, inf.fields[:, 2]), "ld": ld,
            "clSigma": s["cl"], "cdSigma": s["cd"], "ldSigma": ld_sigma,
            "stalled": sep > postproc.SEPARATION_FRACTION, "meshOk": mesh.report.ok,
        }

    def predict(self, design: S.Design) -> S.Prediction:
        """Cached and single-flight per design: concurrent identical requests share one inference."""
        return self._ensure(design).prediction

    def _ensure(self, design: S.Design) -> StoredResult:
        rid = self.result_id(design)
        while True:
            with self._lock:
                if rid in self._results:
                    self._results.move_to_end(rid)
                    return self._results[rid]
                ev = self._inflight.get(rid)
                if ev is None:
                    self._inflight[rid] = threading.Event()
                    break
            ev.wait()
        try:
            stored = self._compute(design, rid)
            with self._lock:
                self._results[rid] = stored
                while len(self._results) > self._size:
                    self._results.popitem(last=False)
            return stored
        finally:
            with self._lock:
                self._inflight.pop(rid).set()

    def _compute(self, design: S.Design, rid: str) -> StoredResult:
        t0 = time.perf_counter()
        mesh, x, inf = self._run(design)
        c, s = inf.coeffs, inf.coeffs_std
        cd = c["cd"]
        ld = c["cl"] / cd if abs(cd) > 1e-9 else float("nan")
        ld_sigma = abs(ld) * math.hypot(s["cl"] / max(abs(c["cl"]), 1e-3), s["cd"] / max(abs(cd), 1e-6))
        sep = postproc.separated_fraction(mesh, inf.fields)
        pred = S.Prediction(
            id=rid,
            design=design,
            reynolds=design.speed * self.engine.chord / self.engine.nu,
            mach=design.speed / SOUND_SPEED,
            cl=c["cl"], cd=cd, cm=postproc.pitching_moment(mesh, x, inf.fields[:, 2]), ld=ld,
            cl_pressure=c["cl_p"], cl_viscous=c["cl_v"], cd_pressure=c["cd_p"], cd_viscous=c["cd_v"],
            uncertainty=S.Uncertainty(cl=s["cl"], cd=s["cd"], ld=ld_sigma),
            envelope=self.envelope_checks(design, inf.warnings),
            mesh=self.mesh_info(mesh, inf.warnings),
            surface=S.SurfaceDistribution(**postproc.surface_cp(mesh, x, inf.fields[:, 2])),
            stalled=sep > postproc.SEPARATION_FRACTION,
            separated_fraction=sep,
            timing_ms=(time.perf_counter() - t0) * 1e3,
            model_version=self.model_version,
        )
        return StoredResult(mesh=mesh, x=x, fields=inf.fields, prediction=pred)

    def field_for(self, design: S.Design, window: str) -> dict:
        r = self._ensure(design)
        return postproc.rasterize(r.mesh, r.x, r.fields, self.engine.nu, window)

    def field(self, result_id: str, window: str) -> dict | None:
        with self._lock:
            r = self._results.get(result_id)
        if r is None:
            return None
        return postproc.rasterize(r.mesh, r.x, r.fields, self.engine.nu, window)

    def sweep(self, req: S.SweepRequest) -> list[S.PolarPoint]:
        n = int(math.floor((req.aoa_end - req.aoa_start) / req.aoa_step + 1e-9)) + 1
        out = []
        for k in range(max(n, 1)):
            aoa = round(req.aoa_start + k * req.aoa_step, 4)
            c = self.coefficients(req.design.model_copy(update={"aoa": aoa}))
            out.append(S.PolarPoint(aoa=aoa, cl=c["cl"], cd=c["cd"], cm=c["cm"], ld=c["ld"],
                                    cl_sigma=c["clSigma"], cd_sigma=c["cdSigma"], stalled=c["stalled"]))
        return out
