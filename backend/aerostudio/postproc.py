"""Post-processing of predicted (or CFD) fields on a prepared mesh.

- surface Cp on upper/lower surfaces, resampled to a common x/c grid for the UI;
- pitching moment about the quarter chord (pressure part; wall shear contributes < 1%);
- separation indicator: reversed near-wall flow on the upper/lower surface;
- rasterization of the unstructured fields onto a regular grid (the UI's field view).
"""

from __future__ import annotations

import math

import numpy as np

from aerostudio.meshing.library import PreparedMesh

X_GRID = 0.5 * (1 - np.cos(np.linspace(0, np.pi, 101)))
SEPARATION_FRACTION = 0.10  # reversed flow over more than 10% of a surface -> "stalled"

WINDOWS = {
    "near": dict(xmin=-0.6, xmax=1.8, ymin=-0.6, ymax=0.6, nx=260),
    "wake": dict(xmin=-0.5, xmax=3.5, ymin=-1.0, ymax=1.0, nx=260),
}


def q_inf(x: np.ndarray) -> float:
    return 0.5 * float(x[0, 6] ** 2 + x[0, 7] ** 2)


def surface_cp(mesh: PreparedMesh, x: np.ndarray, p: np.ndarray) -> dict:
    q = q_inf(x)
    pos = mesh.pos
    x_le = pos[mesh.upper[0], 0]
    chord = pos[mesh.upper[-1], 0] - x_le
    out = {"x": X_GRID.tolist()}
    for name, chain in (("cpUpper", mesh.upper), ("cpLower", mesh.lower)):
        xc = (pos[chain, 0] - x_le) / chord
        order = np.argsort(xc)
        out[name] = np.interp(X_GRID, xc[order], p[chain][order] / q).tolist()
    return out


def pitching_moment(mesh: PreparedMesh, x: np.ndarray, p: np.ndarray) -> float:
    """Cm about (0.25 c, 0), positive nose-up."""
    pos = mesh.pos
    loop = np.r_[mesh.lower[::-1], mesh.upper[1:]]  # TE -> lower -> LE -> upper -> TE (clockwise)
    a, b = loop[:-1], loop[1:]
    t = pos[b] - pos[a]
    ds = np.linalg.norm(t, axis=1)
    n_out = np.stack([-t[:, 1], t[:, 0]], 1) / np.maximum(ds, 1e-300)[:, None]  # clockwise loop -> outward
    mid = 0.5 * (pos[a] + pos[b])
    pm = 0.5 * (p[a] + p[b])
    f = -(pm * ds)[:, None] * n_out
    m_ccw = ((mid[:, 0] - 0.25) * f[:, 1] - mid[:, 1] * f[:, 0]).sum()
    return float(-m_ccw / q_inf(x))


def separated_fraction(mesh: PreparedMesh, fields: np.ndarray) -> float:
    """Largest fraction (by chord) of either surface with reversed near-wall flow."""
    pos = mesh.pos
    worst = 0.0
    for chain in (mesh.upper, mesh.lower):
        t = np.gradient(pos[chain], axis=0)  # LE -> TE tangent
        t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-300)
        nb = mesh.wall_fluid_neighbor[chain]
        ok = nb >= 0
        ut = (fields[nb[ok], :2] * t[ok]).sum(1)
        xc = pos[chain[ok], 0]
        inner = (xc > 0.02) & (xc < 0.99)
        dx = np.gradient(xc)
        worst = max(worst, float((dx * (ut < 0))[inner].sum() / max(dx[inner].sum(), 1e-12)))
    return worst


def _inside(px: np.ndarray, py: np.ndarray, poly: np.ndarray) -> np.ndarray:
    inside = np.zeros(px.shape, bool)
    xs, ys = poly[:, 0], poly[:, 1]
    x2, y2 = np.roll(xs, -1), np.roll(ys, -1)
    for xi, yi, xj, yj in zip(xs, ys, x2, y2):
        cond = (yi > py) != (yj > py)
        xcross = (xj - xi) * (py - yi) / ((yj - yi) if yj != yi else 1e-300) + xi
        inside ^= cond & (px < xcross)
    return inside


def rasterize(mesh: PreparedMesh, x: np.ndarray, fields: np.ndarray, nu: float, window: str = "near") -> dict:
    w = WINDOWS[window]
    nx = w["nx"]
    ny = round(nx * (w["ymax"] - w["ymin"]) / (w["xmax"] - w["xmin"]))
    gx = w["xmin"] + (np.arange(nx) + 0.5) / nx * (w["xmax"] - w["xmin"])
    gy = w["ymin"] + (np.arange(ny) + 0.5) / ny * (w["ymax"] - w["ymin"])
    X, Y = np.meshgrid(gx, gy)  # row-major j * nx + i, j = y index (bottom first)
    pts = np.stack([X.ravel(), Y.ravel()], 1)
    d, idx = mesh.tree().query(pts, k=4)
    wts = 1.0 / np.maximum(d, 1e-9) ** 2
    wts /= wts.sum(1, keepdims=True)
    vals = (fields[idx] * wts[..., None]).sum(1)  # (P, 4)

    poly = mesh.pos[np.r_[mesh.lower[::-1], mesh.upper[1:]]]
    box = (pts[:, 0] > poly[:, 0].min()) & (pts[:, 0] < poly[:, 0].max()) & (pts[:, 1] > poly[:, 1].min()) & (pts[:, 1] < poly[:, 1].max())
    body = np.zeros(len(pts), bool)
    body[box] = _inside(pts[box, 0], pts[box, 1], poly)

    speed = math.sqrt(2 * q_inf(x))
    ux, uy, p, nut = vals.T
    out = {
        "cp": p / q_inf(x),
        "umag": np.hypot(ux, uy) / speed,
        "ux": ux,
        "uy": uy,
        "nut": np.maximum(nut, 0.0) / nu,
    }
    u, v = ux / speed, uy / speed
    for arr in (*out.values(), u, v):
        arr[body] = np.nan
    u[body] = 0.0
    v[body] = 0.0
    return {
        "nx": nx, "ny": ny, "xmin": w["xmin"], "xmax": w["xmax"], "ymin": w["ymin"], "ymax": w["ymax"],
        "vars": out, "u": u, "v": v, "speed": speed,
    }
