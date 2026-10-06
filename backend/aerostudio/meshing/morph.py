"""Mesh morphing: deform an AirfRANS base mesh onto a new NACA airfoil.

1. Surface correspondence. The base wall is split at the leading edge (min x) and the
   trailing edge (max x) into upper and lower chains. Each wall node keeps its normalized
   arc length on its chain and moves to the same normalized arc length on the new
   airfoil's contour. The map is monotonic, so wall nodes can never collapse.
2. Volume deformation, hybrid:
   - near the wall, every node moves with its foot point (closest point on the wall
     polyline, displacement interpolated along the wall), so each wall-normal stack of
     boundary-layer cells (first cell ~1.6e-6 c, aspect ratio ~1000) translates rigidly;
   - away from the wall, inverse-distance weighting from a subsample of wall nodes gives
     a smooth field;
   - the two blend with exp(-(d/BLEND)^2), and a C2 Wendland decay brings the
     displacement to zero before the domain boundary, so the far field stays fixed.
3. Feature rebuild. Signed distance, wall normals, inflow, NACA columns and edge
   features are recomputed with the same conventions as the surrogate's preprocessing;
   tests/test_morph.py checks them against real AirfRANS graphs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from aerostudio.geometry.naca import NacaParams, airfoil
from aerostudio.meshing.cells import scaled_jacobian, signed_areas

N_DENSE = 3000  # contour points per side for the target airfoil
IDW_POWER = 3.0
IDW_STRIDE = 5  # wall-node subsampling for the far-field IDW sources
BLEND = 0.1  # chords: near-wall (foot-point) to far-field (IDW) blending length
DECAY_RADIUS = 1.4  # chords; the cropped AirfRANS domain boundary is >= ~1.5 c from the wall
MIN_SCALED_JACOBIAN = 0.2  # quality gate


@dataclass
class BaseMesh:
    id: str
    x: np.ndarray  # (N, 12) raw features
    edges: np.ndarray  # (2, E) undirected, i < j
    quads: np.ndarray  # (F, 4) CCW
    y: np.ndarray | None = None  # (N, 4) CFD ground truth, when available

    @property
    def pos(self) -> np.ndarray:
        return self.x[:, :2].astype(np.float64)

    @property
    def surface(self) -> np.ndarray:
        return self.x[:, 3] > 0.5

    @property
    def params(self) -> NacaParams:
        return NacaParams.from_raw(self.x[0, 8:12])


@dataclass
class MorphReport:
    base_id: str
    max_surface_displacement: float
    n_inverted: int
    min_scaled_jacobian: float
    base_min_scaled_jacobian: float
    first_cell_height: float
    ok: bool
    message: str = ""


# ------------------------------------------------------------------ wall topology
def wall_segments(edges: np.ndarray, surface: np.ndarray) -> np.ndarray:
    m = surface[edges[0]] & surface[edges[1]]
    return edges[:, m]


def wall_loop(edges: np.ndarray, surface: np.ndarray) -> np.ndarray:
    """Wall node ids in cyclic order (the wall segments form a single closed loop)."""
    seg = wall_segments(edges, surface)
    nbrs: dict[int, list[int]] = {}
    for a, b in seg.T.tolist():
        nbrs.setdefault(a, []).append(b)
        nbrs.setdefault(b, []).append(a)
    start = next(iter(nbrs))
    loop, prev, cur = [start], -1, start
    while True:
        nxt = nbrs[cur][0] if nbrs[cur][0] != prev else nbrs[cur][1]
        if nxt == start:
            break
        loop.append(nxt)
        prev, cur = cur, nxt
    if len(loop) != len(nbrs):
        raise ValueError("wall is not a single closed loop")
    return np.asarray(loop)


# ------------------------------------------------------------------ surface mapping
def _arclength(p: np.ndarray) -> np.ndarray:
    s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    return s / s[-1]


def wall_chains(pos: np.ndarray, loop: np.ndarray):
    """(upper, lower) wall node chains, each ordered leading edge -> trailing edge."""
    loop = np.roll(loop, -int(np.argmin(pos[loop, 0])))  # start at the leading edge
    te = int(np.argmax(pos[loop, 0]))
    a = loop[: te + 1]
    b = np.r_[loop[te:], loop[:1]][::-1]
    return (a, b) if pos[a, 1].mean() > pos[b, 1].mean() else (b, a)


def surface_targets(pos: np.ndarray, loop: np.ndarray, target: NacaParams) -> tuple[np.ndarray, np.ndarray]:
    """(wall node ids, new positions): same normalized arc length on the target contour."""
    af = airfoil(target, n_side=N_DENSE)
    ids, out = [], []
    for chain, contour in zip(wall_chains(pos, loop), (af.upper, af.lower)):
        s_base = _arclength(pos[chain])
        s_tgt = _arclength(contour)
        ids.append(chain)
        out.append(np.stack([np.interp(s_base, s_tgt, contour[:, 0]), np.interp(s_base, s_tgt, contour[:, 1])], 1))
    ids_all = np.concatenate(ids)
    out_all = np.concatenate(out)
    ids_u, first = np.unique(ids_all, return_index=True)  # LE/TE appear in both chains
    return ids_u, out_all[first]


# ------------------------------------------------------------------ distances
def foot_points(pos: np.ndarray, wall_nodes: np.ndarray, segments: np.ndarray, k: int = 4):
    """Closest point on the wall polyline: (distance, segment id, parameter t along it)."""
    seg_by_node: dict[int, list[int]] = {}
    for s_id, (a, b) in enumerate(segments.T.tolist()):
        seg_by_node.setdefault(a, []).append(s_id)
        seg_by_node.setdefault(b, []).append(s_id)
    inc = np.full((len(wall_nodes), 2), -1, dtype=np.int64)
    for i, n in enumerate(wall_nodes.tolist()):
        segs = seg_by_node.get(n, [])[:2]
        inc[i, : len(segs)] = segs
    _, near = cKDTree(pos[wall_nodes]).query(pos, k=k)
    cand = inc[near].reshape(len(pos), -1)
    a = pos[segments[0]][np.maximum(cand, 0)]
    b = pos[segments[1]][np.maximum(cand, 0)]
    ab = b - a
    q = pos[:, None, :]
    t = np.clip(((q - a) * ab).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-300), 0.0, 1.0)
    d = np.linalg.norm(a + t[..., None] * ab - q, axis=-1)
    d[cand < 0] = np.inf
    j = d.argmin(1)
    rows = np.arange(len(pos))
    return d[rows, j], cand[rows, j], t[rows, j]


def signed_distance(pos: np.ndarray, wall_nodes: np.ndarray, segments: np.ndarray) -> np.ndarray:
    """Exact distance to the wall polyline (0 on the wall, positive in the fluid)."""
    return foot_points(pos, wall_nodes, segments)[0]


# ------------------------------------------------------------------ volume deformation
def _wendland(r: np.ndarray, radius: float) -> np.ndarray:
    s = np.clip(r / radius, 0.0, 1.0)
    return (1 - s) ** 4 * (4 * s + 1)


def _idw(pos: np.ndarray, src: np.ndarray, val: np.ndarray, chunk: int = 8192) -> np.ndarray:
    out = np.zeros((len(pos), val.shape[1]))
    for start in range(0, len(pos), chunk):
        p = pos[start:start + chunk]
        r = np.sqrt(((p[:, None, :] - src[None, :, :]) ** 2).sum(-1))
        w = 1.0 / np.maximum(r, 1e-12) ** IDW_POWER
        out[start:start + chunk] = (w @ val) / w.sum(1, keepdims=True)
    return out


def volume_displacement(pos, wall_ids, wall_disp, segments, dist, seg_id, t) -> np.ndarray:
    """Hybrid foot-point / IDW displacement for every node (exact on the wall)."""
    disp_node = np.zeros_like(pos)
    disp_node[wall_ids] = wall_disp
    near = disp_node[segments[0, seg_id]] * (1 - t)[:, None] + disp_node[segments[1, seg_id]] * t[:, None]
    alpha = np.exp(-((dist / BLEND) ** 2))
    active = dist < DECAY_RADIUS
    far = np.zeros_like(pos)
    need_far = active & (alpha < 0.999)
    src = wall_ids[::IDW_STRIDE]
    far[need_far] = _idw(pos[need_far], pos[src], disp_node[src])
    out = np.zeros_like(pos)
    blended = alpha[:, None] * near + (1 - alpha)[:, None] * far
    out[active] = blended[active] * _wendland(dist[active], DECAY_RADIUS)[:, None]
    return out


# ------------------------------------------------------------------ features
def wall_normals(pos: np.ndarray, edges: np.ndarray, surface: np.ndarray) -> np.ndarray:
    """Unit wall normals pointing INTO the body (AirfRANS convention); zero off the wall.

    Per node: the normalized sum of the unit normals of its two wall segments, which is
    the angle bisector at the sharp trailing edge."""
    loop = wall_loop(edges, surface)
    a, b = loop, np.roll(loop, -1)  # consistently oriented segments around the loop
    t = pos[b] - pos[a]
    t = t / np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-300)
    n_seg = np.stack([t[:, 1], -t[:, 0]], 1)
    normals = np.zeros_like(pos)
    np.add.at(normals, a, n_seg)
    np.add.at(normals, b, n_seg)
    # Orient away from the fluid: a wall node's fluid neighbours lie outside the body.
    fe = edges[:, surface[edges[0]] ^ surface[edges[1]]]
    w = np.where(surface[fe[0]], fe[0], fe[1])
    f = np.where(surface[fe[0]], fe[1], fe[0])
    fluid_dir = np.zeros_like(pos)
    np.add.at(fluid_dir, w, pos[f] - pos[w])
    # One global sign (the loop orientation), decided by the majority of wall nodes.
    sign = 1.0 if np.sign((normals * fluid_dir).sum(1)[surface]).sum() > 0 else -1.0
    normals *= -sign
    norm = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(norm > 0, normals / np.maximum(norm, 1e-300), 0.0)
    normals[~surface] = 0.0
    return normals


def directed_edges(edges: np.ndarray) -> np.ndarray:
    """Bidirectional edge_index sorted by (src, dst), as preprocessing's build_edge_index."""
    both = np.hstack([edges, edges[::-1]]).astype(np.int64)
    order = np.lexsort((both[1], both[0]))
    return both[:, order]


def edge_features(pos: np.ndarray, edge_index: np.ndarray) -> np.ndarray:
    d = pos[edge_index[1]] - pos[edge_index[0]]
    return np.hstack([d, np.linalg.norm(d, axis=1, keepdims=True)]).astype(np.float32)


def build_features(pos: np.ndarray, base: BaseMesh, target: NacaParams, aoa_deg: float, speed: float) -> np.ndarray:
    """Raw 12-column node features: [x, y, sdf, surface, n_x, n_y, U_x, U_y, naca_1..4]."""
    surface = base.surface
    x = np.zeros((len(pos), 12), dtype=np.float32)
    x[:, 0:2] = pos
    sdf = signed_distance(pos, np.nonzero(surface)[0], wall_segments(base.edges, surface))
    sdf[surface] = 0.0
    x[:, 2] = sdf
    x[:, 3] = surface
    x[:, 4:6] = wall_normals(pos, base.edges, surface)
    set_inflow(x, aoa_deg, speed)
    x[:, 8:12] = np.asarray(target.raw(), dtype=np.float32)
    return x


def set_inflow(x: np.ndarray, aoa_deg: float, speed: float) -> None:
    """AoA and speed only enter through the inflow columns: a morphed mesh is reusable."""
    a = math.radians(aoa_deg)
    x[:, 6] = speed * math.cos(a)
    x[:, 7] = speed * math.sin(a)


# ------------------------------------------------------------------ top level
def morph(base: BaseMesh, target: NacaParams) -> tuple[np.ndarray, MorphReport]:
    """Deformed node positions and a quality report. Topology (edges, quads) is unchanged."""
    pos = base.pos
    surface = base.surface
    segments = wall_segments(base.edges, surface)
    loop = wall_loop(base.edges, surface)
    wall_ids, new_wall = surface_targets(pos, loop, target)
    wall_disp = new_wall - pos[wall_ids]
    dist, seg_id, t = foot_points(pos, np.nonzero(surface)[0], segments)
    new_pos = pos + volume_displacement(pos, wall_ids, wall_disp, segments, dist, seg_id, t)
    new_pos[wall_ids] = new_wall

    area = signed_areas(new_pos, base.quads)
    sj = scaled_jacobian(new_pos, base.quads)
    base_sj = float(scaled_jacobian(pos, base.quads).min())
    inverted = int((area <= 0).sum())
    fe = base.edges[:, surface[base.edges[0]] ^ surface[base.edges[1]]]
    first_cell = float(np.linalg.norm(new_pos[fe[0]] - new_pos[fe[1]], axis=1).min())
    ok = inverted == 0 and float(sj.min()) > MIN_SCALED_JACOBIAN
    if ok:
        message = ""
    elif inverted:
        message = f"{inverted} inverted cells"
    else:
        message = f"distorted cells (min scaled Jacobian {sj.min():.2f})"
    report = MorphReport(
        base_id=base.id,
        max_surface_displacement=float(np.linalg.norm(wall_disp, axis=1).max()),
        n_inverted=inverted,
        min_scaled_jacobian=float(sj.min()),
        base_min_scaled_jacobian=base_sj,
        first_cell_height=first_cell,
        ok=ok,
        message=message,
    )
    return new_pos, report
