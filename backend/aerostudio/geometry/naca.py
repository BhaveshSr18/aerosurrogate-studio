"""Analytic NACA 4- and 5-digit airfoils in AirfRANS case-name units.

4-digit: [M, P, T]      max camber % chord, camber position in tenths, thickness % chord
5-digit: [L, P, Q, T]   design lift (Cl_i = 0.15 L), camber position in twentieths,
                        reflex flag, thickness % chord

The conventions are verified against the surface nodes of real AirfRANS meshes by
scripts/validate_geometry.py (see backend/README.md for the measured error).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# Reflexed 5-digit series: tabulated r(p), linearly extrapolated outside p = 0.10..0.25.
_REFLEX_P = np.array([0.10, 0.15, 0.20, 0.25])
_REFLEX_R = np.array([0.130, 0.217, 0.318, 0.441])


@dataclass(frozen=True)
class NacaParams:
    family: str  # "4" | "5"
    M: float = 0.0
    P: float = 0.0
    T: float = 12.0
    L: float = 0.0
    Q: int = 0

    @classmethod
    def from_raw(cls, raw4) -> "NacaParams":
        """From the 4 raw NACA columns stored in AirfRANS graphs ([M,P,T,0] or [L,P,Q,T])."""
        a, b, c, d = (float(v) for v in raw4)
        if d > 0:
            return cls(family="5", L=a, P=b, Q=int(round(c)), T=d)
        return cls(family="4", M=a, P=b, T=c)

    def raw(self) -> list[float]:
        """Inverse of from_raw: the 4 graph columns."""
        if self.family == "4":
            return [self.M, self.P, self.T, 0.0]
        return [self.L, self.P, float(self.Q), self.T]

    def canonical(self) -> list[float]:
        """[is_5digit, camber_param, camber_pos, reflex, thickness] (datasets/features.canonical_naca)."""
        if self.family == "4":
            return [0.0, self.M, self.P, 0.0, self.T]
        return [1.0, self.L, self.P, float(self.Q), self.T]


def half_thickness(x: np.ndarray, t: float, closed_te: bool = True) -> np.ndarray:
    a4 = -0.1036 if closed_te else -0.1015
    return 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 + a4 * x**4)


def _camber4(p: NacaParams, x: np.ndarray):
    m, pp = p.M / 100.0, p.P / 10.0
    if m <= 0 or pp <= 0 or pp >= 1:
        return np.zeros_like(x), np.zeros_like(x)
    fore = x < pp
    yc = np.where(fore, m / pp**2 * (2 * pp * x - x**2), m / (1 - pp) ** 2 * (1 - 2 * pp + 2 * pp * x - x**2))
    dyc = np.where(fore, 2 * m / pp**2 * (pp - x), 2 * m / (1 - pp) ** 2 * (pp - x))
    return yc, dyc


def _camber5_unit(r: float, reflex: bool, k21: float, x: np.ndarray):
    fore = x < r
    if not reflex:
        yc = np.where(fore, (x**3 - 3 * r * x**2 + r**2 * (3 - r) * x) / 6, r**3 * (1 - x) / 6)
        dyc = np.where(fore, (3 * x**2 - 6 * r * x + r**2 * (3 - r)) / 6, -(r**3) / 6)
        return yc, dyc
    c = k21 * (1 - r) ** 3 + r**3
    yc = np.where(fore, ((x - r) ** 3 - c * x + r**3) / 6, (k21 * (x - r) ** 3 - c * x + r**3) / 6)
    dyc = np.where(fore, (3 * (x - r) ** 2 - c) / 6, (3 * k21 * (x - r) ** 2 - c) / 6)
    return yc, dyc


def _camber5(p: NacaParams, x: np.ndarray):
    cl_design = 0.15 * p.L
    pp = p.P / 20.0
    if cl_design <= 0 or pp <= 0:
        return np.zeros_like(x), np.zeros_like(x)
    reflex = p.Q == 1
    if reflex:
        r = float(np.interp(pp, _REFLEX_P, _REFLEX_R, left=np.nan, right=np.nan))
        if math.isnan(r):  # linear extrapolation beyond the table
            i = 0 if pp < _REFLEX_P[0] else -2
            r = _REFLEX_R[i] + (_REFLEX_R[i + 1] - _REFLEX_R[i]) * (pp - _REFLEX_P[i]) / (_REFLEX_P[i + 1] - _REFLEX_P[i])
        r = min(0.9, max(pp + 0.01, r))
    else:
        lo, hi = pp, 0.99  # standard series: p = r (1 - sqrt(r/3))
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            lo, hi = (mid, hi) if mid * (1 - math.sqrt(mid / 3)) < pp else (lo, mid)
        r = 0.5 * (lo + hi)
    k21 = (3 * (r - pp) ** 2 - r**3) / (1 - r) ** 3
    # Scale k1 so the thin-airfoil ideal lift pi*A1 equals the design lift.
    th = (np.arange(400) + 0.5) / 400 * math.pi
    _, d = _camber5_unit(r, reflex, k21, 0.5 * (1 - np.cos(th)))
    a1 = 2 / math.pi * float((d * np.cos(th)).sum()) * math.pi / 400
    k1 = cl_design / (math.pi * a1) if a1 > 1e-12 else 0.0
    yc, dyc = _camber5_unit(r, reflex, k21, x)
    return k1 * yc, k1 * dyc


def camber(p: NacaParams, x: np.ndarray):
    return _camber4(p, x) if p.family == "4" else _camber5(p, x)


@dataclass
class Airfoil:
    upper: np.ndarray  # (n, 2) LE -> TE
    lower: np.ndarray  # (n, 2) LE -> TE
    camber: np.ndarray

    @property
    def loop(self) -> np.ndarray:
        """Closed polygon TE -> lower -> LE -> upper -> TE (clockwise)."""
        return np.vstack([self.lower[::-1], self.upper[1:]])


def airfoil(p: NacaParams, n_side: int = 200, closed_te: bool = True) -> Airfoil:
    beta = np.linspace(0.0, math.pi, n_side + 1)
    x = 0.5 * (1 - np.cos(beta))
    yc, dyc = camber(p, x)
    yt = half_thickness(x, p.T / 100.0, closed_te)
    th = np.arctan(dyc)
    upper = np.stack([x - yt * np.sin(th), yc + yt * np.cos(th)], 1)
    lower = np.stack([x + yt * np.sin(th), yc - yt * np.cos(th)], 1)
    return Airfoil(upper=upper, lower=lower, camber=np.stack([x, yc], 1))


def designation(p: NacaParams) -> str:
    r = lambda v: int(round(v))  # noqa: E731
    if p.family == "4":
        return f"NACA {r(p.M)}{r(p.P)}{r(p.T):02d}"
    return f"NACA {r(p.L)}{r(p.P)}{p.Q}{r(p.T):02d}"
