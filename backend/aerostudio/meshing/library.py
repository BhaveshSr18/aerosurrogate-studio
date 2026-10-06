"""Base-mesh library and the mesh service that turns a NACA design into a model-ready mesh.

Base selection uses geometric similarity, not parameter distance: every shape is
described by its camber line and thickness at fixed chord stations, which compares
4- and 5-digit airfoils on equal terms. If the morph onto the nearest base fails the
quality gate, the next-nearest bases are tried.

AoA and speed only enter through the inflow node columns, so a morphed mesh is cached
per shape and reused for every operating point (polars, AoA optimization).
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from aerostudio.geometry.naca import NacaParams, camber, half_thickness
from aerostudio.meshing.morph import (
    BaseMesh,
    MorphReport,
    build_features,
    directed_edges,
    edge_features,
    morph,
    wall_loop,
    wall_chains,
)

_STATIONS = 0.5 * (1 - np.cos(np.linspace(0.05, np.pi, 16)))
MAX_CANDIDATES = 3


def shape_vector(p: NacaParams) -> np.ndarray:
    yc, _ = camber(p, _STATIONS)
    return np.r_[yc, half_thickness(_STATIONS, p.T / 100.0)]


class BaseMeshLibrary:
    def __init__(self, directory: Path, cache_size: int = 4):
        self.dir = Path(directory)
        manifest = self.dir / "manifest.json"
        if not manifest.exists():
            raise FileNotFoundError(f"no base-mesh library at {self.dir} (run scripts/build_base_library.py)")
        self.entries: list[dict] = json.loads(manifest.read_text())
        self._vectors = np.stack([shape_vector(NacaParams.from_raw(e["naca_raw"])) for e in self.entries])
        self.load = lru_cache(maxsize=cache_size)(self._load)

    def _load(self, mesh_id: str) -> BaseMesh:
        d = np.load(self.dir / f"{mesh_id}.npz")
        y = d["y"] if d["y"].size else None
        return BaseMesh(id=mesh_id, x=d["x"], edges=d["edges"], quads=d["quads"], y=y)

    def ranked(self, p: NacaParams) -> list[tuple[str, float]]:
        """Base ids by geometric distance to p (RMS of camber+thickness differences, % chord)."""
        d = np.sqrt(((self._vectors - shape_vector(p)) ** 2).mean(1)) * 100
        order = np.argsort(d)
        return [(self.entries[i]["id"], float(d[i])) for i in order]

    def entry(self, mesh_id: str) -> dict:
        return next(e for e in self.entries if e["id"] == mesh_id)


@dataclass
class PreparedMesh:
    """A morphed mesh ready for inference at any operating point."""

    key: tuple
    params: NacaParams
    base_id: str
    shape_distance: float
    report: MorphReport
    x: np.ndarray  # (N, 12) raw features; inflow columns are set per request
    edge_index: np.ndarray  # (2, 2E)
    edge_attr: np.ndarray  # (2E, 3)
    edges: np.ndarray  # (2, E) undirected
    upper: np.ndarray  # wall node ids, LE -> TE
    lower: np.ndarray
    wall_fluid_neighbor: np.ndarray  # (N,) nearest off-wall neighbour for wall nodes, -1 elsewhere
    _tree: object = field(default=None, repr=False)

    @property
    def pos(self) -> np.ndarray:
        return self.x[:, :2].astype(np.float64)

    def with_inflow(self, aoa_deg: float, speed: float) -> np.ndarray:
        from aerostudio.meshing.morph import set_inflow

        x = self.x.copy()
        set_inflow(x, aoa_deg, speed)
        return x

    def tree(self):
        if self._tree is None:
            from scipy.spatial import cKDTree

            self._tree = cKDTree(self.pos)
        return self._tree


def _nearest_fluid_neighbor(pos: np.ndarray, edges: np.ndarray, surface: np.ndarray) -> np.ndarray:
    out = np.full(len(pos), -1, dtype=np.int64)
    fe = edges[:, surface[edges[0]] ^ surface[edges[1]]]
    w = np.where(surface[fe[0]], fe[0], fe[1])
    f = np.where(surface[fe[0]], fe[1], fe[0])
    d = np.linalg.norm(pos[f] - pos[w], axis=1)
    order = np.argsort(-d)  # assign longest first so the shortest wins
    out[w[order]] = f[order]
    return out


class MeshService:
    def __init__(self, library: BaseMeshLibrary, cache_size: int = 16, rounding: int = 3):
        self.library = library
        self.rounding = rounding
        self._cache: OrderedDict[tuple, PreparedMesh] = OrderedDict()
        self._size = cache_size
        self._lock = threading.Lock()
        self._inflight: dict[tuple, threading.Event] = {}

    def key(self, p: NacaParams) -> tuple:
        r = self.rounding
        return (p.family, round(p.M, r), round(p.P, r), round(p.T, r), round(p.L, r), int(p.Q))

    def get(self, p: NacaParams) -> PreparedMesh:
        k = self.key(p)
        while True:
            with self._lock:
                if k in self._cache:
                    self._cache.move_to_end(k)
                    return self._cache[k]
                ev = self._inflight.get(k)
                if ev is None:
                    self._inflight[k] = threading.Event()
                    break
            ev.wait()  # another thread is morphing this shape
        try:
            mesh = self._prepare(p, k)
            with self._lock:
                self._cache[k] = mesh
                while len(self._cache) > self._size:
                    self._cache.popitem(last=False)
            return mesh
        finally:
            with self._lock:
                self._inflight.pop(k).set()

    def _prepare(self, p: NacaParams, key: tuple) -> PreparedMesh:
        best = None
        for base_id, dist in self.library.ranked(p)[:MAX_CANDIDATES]:
            base = self.library.load(base_id)
            new_pos, report = morph(base, p)
            if best is None or (report.ok and not best[2].ok) or (report.ok == best[2].ok and report.min_scaled_jacobian > best[2].min_scaled_jacobian):
                best = (base, new_pos, report, dist)
            if report.ok:
                break
        base, new_pos, report, dist = best
        x = build_features(new_pos, base, p, 0.0, 1.0)
        ei = directed_edges(base.edges)
        upper, lower = wall_chains(new_pos, wall_loop(base.edges, base.surface))
        return PreparedMesh(
            key=key,
            params=p,
            base_id=base.id,
            shape_distance=dist,
            report=report,
            x=x,
            edge_index=ei,
            edge_attr=edge_features(new_pos, ei),
            edges=base.edges,
            upper=upper,
            lower=lower,
            wall_fluid_neighbor=_nearest_fluid_neighbor(new_pos, base.edges, base.surface),
        )

    def true_mesh(self, mesh_id: str) -> tuple[PreparedMesh, BaseMesh]:
        """An unmorphed library mesh (dataset views: surrogate vs CFD on the real mesh)."""
        base = self.library.load(mesh_id)
        pos = base.pos
        ei = directed_edges(base.edges)
        upper, lower = wall_chains(pos, wall_loop(base.edges, base.surface))
        report = MorphReport(base.id, 0.0, 0, 0.0, 0.0, 0.0, True, "original AirfRANS mesh")
        mesh = PreparedMesh(
            key=("case", mesh_id), params=base.params, base_id=base.id, shape_distance=0.0, report=report,
            x=base.x.copy(), edge_index=ei, edge_attr=edge_features(pos, ei), edges=base.edges,
            upper=upper, lower=lower, wall_fluid_neighbor=_nearest_fluid_neighbor(pos, base.edges, base.surface),
        )
        return mesh, base
