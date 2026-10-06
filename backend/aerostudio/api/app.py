"""FastAPI application: the contract consumed by frontend/src/lib/api/http-client.ts.

    uvicorn aerostudio.api.app:app --port 8000

Endpoints
    GET    /api/health                      model + pipeline status
    GET    /api/envelope                    training ranges for the UI sliders
    POST   /api/predict                     coefficients, uncertainty, checks, surface Cp
    GET    /api/results/{id}/field          rasterized flow field of a previous prediction
    POST   /api/field                       rasterized flow field for a design (cached with predict)
    POST   /api/sweep                       AoA polar
    POST   /api/optimize                    start an optimization job -> {jobId}
    GET    /api/jobs/{id}/stream            SSE: progress* then done | error | cancelled
    DELETE /api/jobs/{id}                   cancel
    GET    /api/dataset/cases               library cases (real AirfRANS meshes with CFD)
    GET    /api/dataset/cases/{id}/compare  surrogate vs CFD on the real mesh
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from aerostudio import optimize as opt
from aerostudio.api import schemas as S
from aerostudio.jobs import JobManager
from aerostudio.meshing.library import BaseMeshLibrary, MeshService
from aerostudio.service import PredictionService
from aerostudio.settings import Settings, settings as default_settings

log = logging.getLogger("aerostudio")
MAX_SWEEP_POINTS = 81


def _jsonable(obj):
    """numpy -> lists with NaN as null (JSON has no NaN)."""
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        a = obj.astype(np.float64)
        return [None if not math.isfinite(v) else round(v, 6) for v in a.tolist()]
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def create_app(cfg: Settings | None = None, engine=None) -> FastAPI:
    """`engine` may be injected (tests); otherwise the surrogate adapter is loaded."""
    cfg = cfg or default_settings
    state: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logging.getLogger("surrogate").setLevel(logging.ERROR)  # envelope warnings are returned, not logged
        eng = engine
        state["error"] = None
        if eng is None:
            try:
                from aerostudio.engine.adapter import SurrogateEngine

                eng = SurrogateEngine(cfg.surrogate_repo, cfg.surrogate_commit, cfg.surrogate_pin_mode,
                                      cfg.checkpoint_paths, cfg.device, cfg.torch_threads)
            except Exception as e:  # noqa: BLE001 - surfaced by /api/health
                log.error("surrogate engine unavailable: %s", e)
                state["error"] = str(e)
        try:
            library = BaseMeshLibrary(cfg.base_mesh_dir)
            state["meshes"] = MeshService(library, cfg.mesh_cache_size, cfg.shape_rounding)
        except Exception as e:  # noqa: BLE001
            log.error("base-mesh library unavailable: %s", e)
            state["error"] = (state["error"] + "; " if state["error"] else "") + str(e)
        if eng is not None and "meshes" in state:
            state["svc"] = PredictionService(eng, state["meshes"], cfg.result_cache_size)
        state["jobs"] = JobManager(cfg.max_concurrent_jobs)
        yield

    app = FastAPI(title="AeroSurrogate Studio API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in cfg.cors_origins.split(",") if o.strip()],
                       allow_methods=["*"], allow_headers=["*"])

    def svc() -> PredictionService:
        s = state.get("svc")
        if s is None:
            raise HTTPException(503, f"surrogate unavailable: {state.get('error')}")
        return s

    async def blocking(fn, *args):
        return await asyncio.to_thread(fn, *args)

    # ------------------------------------------------------------------ status
    @app.get("/api/health", response_model=S.ModelInfo)
    def health():
        s = state.get("svc")
        if s is None:
            return S.ModelInfo(name="MeshGraphNet surrogate", version="-", status="unavailable", detail={"error": state.get("error")})
        info = s.engine.info
        _, provisional = s.envelope_ranges()
        return S.ModelInfo(
            name=info.get("name", "surrogate"), version=s.model_version, status="unvalidated",
            checkpoint=", ".join(info.get("checkpoints", [])),
            detail={**info, "envelope_provisional": provisional, "base_meshes": len(state["meshes"].library.entries)},
        )

    @app.get("/api/envelope", response_model=S.Envelope)
    def envelope():
        return svc().envelope()

    # ------------------------------------------------------------------ prediction
    @app.post("/api/predict", response_model=S.Prediction)
    async def predict(req: S.PredictRequest):
        return await blocking(svc().predict, req.design)

    @app.get("/api/results/{result_id}/field")
    async def field(result_id: str, window: str = Query("near", pattern="^(near|wake)$")):
        data = await blocking(svc().field, result_id, window)
        if data is None:
            raise HTTPException(404, "unknown or expired result id; call /api/predict first")
        return JSONResponse(_jsonable(data))

    @app.post("/api/field")
    async def field_for(req: S.FieldRequest):
        """Field for a design; reuses the cached prediction when /api/predict ran first."""
        return JSONResponse(_jsonable(await blocking(svc().field_for, req.design, req.window)))

    @app.post("/api/sweep", response_model=list[S.PolarPoint])
    async def sweep(req: S.SweepRequest):
        if req.aoa_end < req.aoa_start:
            raise HTTPException(422, "aoaEnd must be >= aoaStart")
        if (req.aoa_end - req.aoa_start) / req.aoa_step + 1 > MAX_SWEEP_POINTS:
            raise HTTPException(422, f"at most {MAX_SWEEP_POINTS} points per sweep")
        return await blocking(svc().sweep, req)

    # ------------------------------------------------------------------ optimization
    @app.post("/api/optimize", response_model=S.JobCreated)
    def optimize(cfg_req: S.OptimizationConfig):
        service = svc()

        def work(job):
            def progress(u: S.GenerationUpdate):
                job.emit("progress", u.model_dump(mode="json"))

            result = opt.run(cfg_req, service.coefficients, progress, job.cancel_flag.is_set)
            return result.model_dump(mode="json")

        job = state["jobs"].submit("optimize", work)
        return S.JobCreated(job_id=job.id)

    @app.get("/api/jobs/{job_id}/stream")
    async def stream(job_id: str, request: Request):
        job = state["jobs"].get(job_id)
        if job is None:
            raise HTTPException(404, "unknown job")

        async def gen():
            offset = 0
            while True:
                if await request.is_disconnected():
                    return
                events = await asyncio.to_thread(job.wait_events, offset, 1.0)
                for name, data in events:
                    yield {"event": name, "data": json.dumps(data, allow_nan=False, default=float)}
                offset += len(events)
                if job.finished and offset >= len(job.events):
                    return

        return EventSourceResponse(gen(), ping=15)

    @app.delete("/api/jobs/{job_id}")
    def cancel(job_id: str):
        if not state["jobs"].cancel(job_id):
            raise HTTPException(404, "unknown job")
        return {"cancelled": True}

    # ------------------------------------------------------------------ dataset
    @app.get("/api/dataset/cases")
    def cases():
        meshes = state.get("meshes")
        if meshes is None:
            raise HTTPException(503, state.get("error"))
        return [{k: e[k] for k in ("id", "designation", "family", "naca_raw", "u_inf", "aoa_deg", "n_nodes", "has_ground_truth")}
                for e in meshes.library.entries]

    @app.get("/api/dataset/cases/{case_id}/compare")
    async def compare(case_id: str):
        service = svc()
        meshes = state["meshes"]
        if not any(e["id"] == case_id for e in meshes.library.entries):
            raise HTTPException(404, "unknown case")

        def work():
            from aerostudio import postproc

            mesh, base = meshes.true_mesh(case_id)
            if base.y is None:
                raise HTTPException(409, "case has no CFD ground truth")
            inf = service.engine.infer(mesh.x, mesh.edge_index, mesh.edge_attr)
            cfd = service.engine.coefficients_from_fields(mesh.x, mesh.edge_index, base.y, mesh.x[0, 6:8])
            err = inf.fields - base.y
            rel_l2 = (np.linalg.norm(err, axis=0) / np.maximum(np.linalg.norm(base.y, axis=0), 1e-12)).tolist()
            return {
                "case": meshes.library.entry(case_id),
                "cfd": {"cl": cfd["cl"], "cd": cfd["cd"], "cm": postproc.pitching_moment(mesh, mesh.x, base.y[:, 2]),
                        "surface": postproc.surface_cp(mesh, mesh.x, base.y[:, 2])},
                "surrogate": {"cl": inf.coeffs["cl"], "cd": inf.coeffs["cd"],
                              "cm": postproc.pitching_moment(mesh, mesh.x, inf.fields[:, 2]),
                              "surface": postproc.surface_cp(mesh, mesh.x, inf.fields[:, 2])},
                "relL2": dict(zip(["Ux", "Uy", "p", "nut"], rel_l2)),
                "warnings": inf.warnings,
            }

        return JSONResponse(_jsonable(await blocking(work)))

    return app


app = create_app()
