/**
 * Analytic NACA 4- and 5-digit airfoil geometry.
 *
 * Parameter units follow the AirfRANS case names (see the surrogate repo's
 * datasets/features.py): 4-digit [M %, P tenths, T %], 5-digit [L, P, Q, T %].
 *
 * PLACEHOLDER NOTE: the 5-digit mapping (design Cl = 0.15 L, max-camber position P/20)
 * and the closed trailing edge are the textbook conventions. They still need checking
 * against the exact generator AirfRANS used; that check belongs in the backend
 * (roadmap Phase 1), which will serve the authoritative geometry.
 */
import type { AirfoilGeometry, Design, Naca4Params, Naca5Params, Point } from "../types";

const N_SIDE = 80;

/**
 * NACA 4-digit camber position: 0 means "no camber"; otherwise the peak sits at P >= 1 (10 %
 * chord), as in NACA practice and every AirfRANS sample. Peaks closer to the nose produce a
 * hooked, self-intersecting leading edge, so values in (0, 1) snap to the nearer valid one.
 */
export function snapCamberPosition(P: number) {
  if (P <= 0 || !Number.isFinite(P)) return 0;
  return P < 0.5 ? 0 : Math.max(1, P);
}

function cosineSpacing(n: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push(0.5 * (1 - Math.cos((Math.PI * i) / n)));
  return xs;
}

/** Half-thickness, closed trailing edge variant. */
function thickness(x: number, t: number) {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

type Camber = (x: number) => { yc: number; dyc: number };

function camber4(p: Naca4Params): Camber {
  const m = p.M / 100;
  const pp = p.P / 10;
  if (m <= 0 || pp <= 0 || pp >= 1) return () => ({ yc: 0, dyc: 0 });
  return (x) =>
    x < pp
      ? { yc: (m / pp ** 2) * (2 * pp * x - x * x), dyc: ((2 * m) / pp ** 2) * (pp - x) }
      : { yc: (m / (1 - pp) ** 2) * (1 - 2 * pp + 2 * pp * x - x * x), dyc: ((2 * m) / (1 - pp) ** 2) * (pp - x) };
}

/** Unit-k1 5-digit camber line for a given r (and reflex ratio k2/k1). */
function camber5Unit(r: number, reflex: boolean, k21: number): Camber {
  if (!reflex) {
    return (x) =>
      x < r
        ? { yc: (x ** 3 - 3 * r * x * x + r * r * (3 - r) * x) / 6, dyc: (3 * x * x - 6 * r * x + r * r * (3 - r)) / 6 }
        : { yc: (r ** 3 * (1 - x)) / 6, dyc: -(r ** 3) / 6 };
  }
  return (x) =>
    x < r
      ? {
          yc: ((x - r) ** 3 - k21 * (1 - r) ** 3 * x - r ** 3 * x + r ** 3) / 6,
          dyc: (3 * (x - r) ** 2 - k21 * (1 - r) ** 3 - r ** 3) / 6,
        }
      : {
          yc: (k21 * (x - r) ** 3 - k21 * (1 - r) ** 3 * x - r ** 3 * x + r ** 3) / 6,
          dyc: (3 * k21 * (x - r) ** 2 - k21 * (1 - r) ** 3 - r ** 3) / 6,
        };
}

/** Thin-airfoil A1 coefficient; the ideal (design) lift coefficient is pi * A1. */
function thinAirfoilA1(c: Camber) {
  const n = 400;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) / n) * Math.PI;
    const x = 0.5 * (1 - Math.cos(th));
    s += c(x).dyc * Math.cos(th);
  }
  return (2 / Math.PI) * s * (Math.PI / n);
}

function camber5(p: Naca5Params): Camber {
  const clDesign = 0.15 * p.L;
  const pp = p.P / 20;
  if (clDesign <= 0 || pp <= 0) return () => ({ yc: 0, dyc: 0 });
  const reflex = p.Q === 1;
  const k21For = (r: number) => (3 * (r - pp) ** 2 - r ** 3) / (1 - r) ** 3;

  let r: number;
  if (reflex) {
    // Tabulated r(p) for the reflexed series (p = 0.10..0.25), linearly extrapolated.
    const P = [0.1, 0.15, 0.2, 0.25];
    const R = [0.13, 0.217, 0.318, 0.441];
    const i = pp <= P[1] ? 0 : pp <= P[2] ? 1 : 2;
    r = R[i] + ((R[i + 1] - R[i]) * (pp - P[i])) / (P[i + 1] - P[i]);
    r = Math.min(0.9, Math.max(pp + 0.01, r));
  } else {
    // Standard series: the camber peak sits at p = r (1 - sqrt(r / 3)); solve for r.
    let lo = pp;
    let hi = 0.99;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (mid * (1 - Math.sqrt(mid / 3)) < pp) lo = mid;
      else hi = mid;
    }
    r = 0.5 * (lo + hi);
  }
  const unit = camber5Unit(r, reflex, k21For(r));
  const a1 = thinAirfoilA1(unit);
  const k1 = a1 > 1e-9 ? clDesign / (Math.PI * a1) : 0;
  return (x) => {
    const { yc, dyc } = unit(x);
    return { yc: k1 * yc, dyc: k1 * dyc };
  };
}

export function geometry(design: Pick<Design, "family" | "naca4" | "naca5">, nSide = N_SIDE): AirfoilGeometry {
  const c = design.family === "4" ? camber4(design.naca4) : camber5(design.naca5);
  const t = (design.family === "4" ? design.naca4.T : design.naca5.T) / 100;
  const xs = cosineSpacing(nSide);
  const upper: Point[] = [];
  const lower: Point[] = [];
  const camberLine: Point[] = [];
  let maxC = { x: 0, c: 0 };
  for (const x of xs) {
    const { yc, dyc } = c(x);
    const yt = thickness(x, t);
    const th = Math.atan(dyc);
    upper.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lower.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
    camberLine.push([x, yc]);
  }
  // Locate the camber peak on a fine grid: the cosine-spaced surface points are too coarse to
  // report it exactly (a NACA 2412 would read 41 % instead of 40 %).
  for (let i = 0; i <= 1000; i++) {
    const x = i / 1000;
    const yc = c(x).yc;
    if (Math.abs(yc) > Math.abs(maxC.c) + 1e-12) maxC = { x, c: yc };
  }
  const maxT = { x: 0.3, t: 2 * thickness(0.3, t) }; // NACA thickness peaks at 30 % chord
  // Clockwise loop: TE -> lower -> LE -> upper -> TE (first/last point shared at TE).
  const loop: Point[] = [...lower.slice().reverse(), ...upper.slice(1)];
  return { upper, lower, camber: camberLine, loop, maxThickness: maxT, maxCamber: maxC };
}

export function designation(design: Pick<Design, "family" | "naca4" | "naca5">): string {
  const r = (v: number) => Math.round(v);
  const isInt = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
  if (design.family === "4") {
    const { M, P, T } = design.naca4;
    // Without camber the position digit is meaningless: NACA convention writes 00xx.
    const symmetric = r(M) === 0;
    const exact = isInt(M) && (symmetric || isInt(P)) && isInt(T);
    return `${exact ? "" : "≈ "}NACA ${r(M)}${symmetric ? 0 : r(P)}${String(r(T)).padStart(2, "0")}`;
  }
  const { L, P, Q, T } = design.naca5;
  const exact = isInt(L) && isInt(P) && isInt(T);
  return `${exact ? "" : "≈ "}NACA ${r(L)}${r(P)}${Q}${String(r(T)).padStart(2, "0")}`;
}

export function thicknessRatio(design: Pick<Design, "family" | "naca4" | "naca5">) {
  return (design.family === "4" ? design.naca4.T : design.naca5.T) / 100;
}

/** Selig-format coordinate file (TE -> upper -> LE -> lower -> TE). */
export function toSelig(design: Design, name: string) {
  const g = geometry(design, 100);
  const pts = [...g.upper.slice().reverse(), ...g.lower.slice(1)];
  const f = (v: number) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6).padStart(10); // never "-0.000000"
  return [name, ...pts.map(([x, y]) => `${f(x)} ${f(y)}`)].join("\n") + "\n";
}
