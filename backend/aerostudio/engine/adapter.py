"""The ONLY bridge to the surrogate-model repository.

The surrogate repo (airfrans-meshgraphnet-surrogate) is developed separately and is not a
Python package, so it is loaded from a checkout pinned by git commit: at startup the
checkout's HEAD must equal settings.surrogate_commit, and its working tree must be clean
(pin mode "strict"). Everything else in the backend talks to `SurrogateEngine`, never
to the surrogate's modules, so a new surrogate release means changing the pin and, if its
public API changed, this file alone.

Public surrogate API used: surrogate.AirfoilSurrogate / SurrogateEnsemble
(from_checkpoint(s), predict, aero_coefficients, check_inputs, normalizer.stats_meta)
and physics.aero_coefficients.SurfaceIntegrator.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


class SurrogatePinError(RuntimeError):
    pass


def verify_pin(repo: Path, commit: str, mode: str) -> str:
    """Return the checkout's HEAD; raise (strict) or warn if it differs from the pin."""
    if not (repo / "surrogate.py").exists():
        raise SurrogatePinError(f"surrogate repo not found at {repo}")
    try:
        head = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain", "--untracked-files=no"], text=True).strip()
    except (OSError, subprocess.CalledProcessError) as e:
        raise SurrogatePinError(f"cannot read git state of {repo}: {e}") from e
    problems = []
    if commit and head != commit:
        problems.append(f"HEAD is {head[:10]}, pinned {commit[:10]}")
    if dirty:
        problems.append("working tree has uncommitted changes")
    if problems:
        msg = f"surrogate repo {repo}: " + "; ".join(problems)
        if mode == "strict":
            raise SurrogatePinError(msg + " (set AEROSTUDIO_SURROGATE_PIN_MODE=warn to override)")
        log.warning(msg)
    return head


@dataclass
class Inference:
    """Physical fields on the input mesh plus integrated coefficients."""

    fields: np.ndarray  # (N, 4) [Ux, Uy, p (kinematic), nu_t], ensemble mean
    fields_std: np.ndarray | None  # (N, 4) member spread, None for a single model
    coeffs: dict  # cl, cd, cl_p, cl_v, cd_p, cd_v (mean)
    coeffs_std: dict  # cl, cd (member spread; 0 for a single model)
    warnings: list[str] = field(default_factory=list)


class SurrogateEngine:
    def __init__(self, repo: Path, commit: str, pin_mode: str, checkpoints: list[Path], device: str = "cpu", threads: int = 0):
        if not checkpoints:
            raise ValueError("no checkpoints configured (AEROSTUDIO_CHECKPOINTS)")
        self.commit = verify_pin(repo, commit, pin_mode)
        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))
        import torch

        if threads:
            torch.set_num_threads(threads)
        import surrogate as S  # noqa: N812  (the surrogate repo's module)

        self._torch = torch
        self._S = S
        self.checkpoints = checkpoints
        if len(checkpoints) == 1:
            self.model = S.AirfoilSurrogate.from_checkpoint(checkpoints[0], device=device)
            self.members = [self.model]
        else:
            self.model = S.SurrogateEnsemble.from_checkpoints(checkpoints, device=device)
            self.members = self.model.members
        self._lock = threading.Lock()  # one forward pass at a time per process
        import config as surrogate_config  # the surrogate repo's config module

        self.nu = float(surrogate_config.NU_MOLECULAR)
        self.chord = float(self.model.normalizer.chord)

    # ------------------------------------------------------------------ info
    @property
    def info(self) -> dict:
        meta = self.model.metadata or {}
        return {
            "name": f"MeshGraphNet ({self.model.variant})" + (f" ensemble x{len(self.members)}" if len(self.members) > 1 else ""),
            "variant": self.model.variant,
            "members": len(self.members),
            "checkpoints": [str(p) for p in self.checkpoints],
            "surrogate_commit": self.commit,
            "checkpoint_commit": meta.get("git_commit") or meta.get("source_fingerprint"),
            "epoch": meta.get("epoch"),
        }

    @property
    def stats_meta(self) -> dict:
        return self.model.normalizer.stats_meta or {}

    # ------------------------------------------------------------------ inference
    def _graph(self, x: np.ndarray, edge_index: np.ndarray, edge_attr: np.ndarray):
        from torch_geometric.data import Data

        t = self._torch
        return Data(x=t.from_numpy(np.ascontiguousarray(x, dtype=np.float32)),
                    edge_index=t.from_numpy(np.ascontiguousarray(edge_index, dtype=np.int64)),
                    edge_attr=t.from_numpy(np.ascontiguousarray(edge_attr, dtype=np.float32)))

    def check_inputs(self, x, edge_index, edge_attr) -> list[str]:
        return list(self.model.check_inputs(self._graph(x, edge_index, edge_attr)))

    def infer(self, x: np.ndarray, edge_index: np.ndarray, edge_attr: np.ndarray, with_checks: bool = True) -> Inference:
        g = self._graph(x, edge_index, edge_attr)
        with self._lock, self._torch.inference_mode():
            warnings = list(self.model.check_inputs(g)) if with_checks else []
            per_member = [m.predict(g) for m in self.members]
            coeffs = [m.aero_coefficients(g, f, nu=self.nu, chord=self.chord) for m, f in zip(self.members, per_member)]
        stack = self._torch.stack(per_member).numpy()
        mean = stack.mean(0)
        std = stack.std(0, ddof=1) if len(per_member) > 1 else None
        keys = coeffs[0].keys()
        c_mean = {k: float(np.mean([c[k] for c in coeffs])) for k in keys}
        c_std = {k: float(np.std([c[k] for c in coeffs], ddof=1)) if len(coeffs) > 1 else 0.0 for k in ("cl", "cd")}
        return Inference(fields=mean, fields_std=std, coeffs=c_mean, coeffs_std=c_std, warnings=warnings)

    def surface_integrator(self, x: np.ndarray, edge_index: np.ndarray):
        """The surrogate's own wall integrator (for coefficients from ground-truth fields)."""
        from physics.aero_coefficients import SurfaceIntegrator

        t = self._torch
        return SurfaceIntegrator(t.from_numpy(x[:, :2].astype(np.float64)), t.from_numpy(edge_index), t.from_numpy(x[:, 3] > 0.5))

    def coefficients_from_fields(self, x, edge_index, fields: np.ndarray, u_inf_vec) -> dict:
        integ = self.surface_integrator(x, edge_index)
        return integ.coefficients(self._torch.from_numpy(fields.astype(np.float64)), u_inf_vec, self.nu, self.chord)
