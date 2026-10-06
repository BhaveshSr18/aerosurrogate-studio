/**
 * Hess-Smith panel method (constant-strength sources + one uniform vortex, Kutta
 * condition). It is the MOCK stand-in for the MeshGraphNet surrogate: it gives
 * physically sensible inviscid Cp and velocity fields so the UI can be developed
 * before the trained checkpoint exists. It is not a RANS solution.
 */
import type { Point } from "../types";

export interface PanelSolution {
  xa: Float64Array;
  ya: Float64Array;
  len: Float64Array;
  cosT: Float64Array;
  sinT: Float64Array;
  xc: Float64Array;
  yc: Float64Array;
  sigma: Float64Array;
  gamma: number;
  /** Tangential velocity / U_inf at each control point (signed along panel tangent). */
  vt: Float64Array;
  cp: Float64Array;
  alpha: number;
  cl: number;
  cm: number;
}

const INV_2PI = 1 / (2 * Math.PI);

/** Velocity induced at (px,py) by panel j: [us, vs] (unit source) and [uv, vv] (unit vortex), global frame. */
function influence(
  px: number,
  py: number,
  ax: number,
  ay: number,
  L: number,
  c: number,
  s: number,
  self: boolean,
  out: Float64Array,
) {
  const dx = px - ax;
  const dy = py - ay;
  const xi = dx * c + dy * s;
  const eta = -dx * s + dy * c;
  const r1 = xi * xi + eta * eta;
  const r2 = (xi - L) * (xi - L) + eta * eta;
  const lnr = 0.5 * Math.log(r1 / r2) * INV_2PI; // (1/2pi) ln(r1/r2)
  const beta = self ? Math.PI : Math.atan2(eta * L, xi * (xi - L) + eta * eta);
  const b = beta * INV_2PI;
  // source (local): u = lnr, v = b ; vortex (local): u = b, v = -lnr
  out[0] = lnr * c - b * s;
  out[1] = lnr * s + b * c;
  out[2] = b * c + lnr * s;
  out[3] = b * s - lnr * c;
}

function solveDense(A: Float64Array, b: Float64Array, n: number) {
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j];
        A[k * n + j] = A[piv * n + j];
        A[piv * n + j] = t;
      }
      const t = b[k];
      b[k] = b[piv];
      b[piv] = t;
    }
    const akk = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / akk;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}

export function solvePanels(loop: Point[], alphaDeg: number): PanelSolution {
  const N = loop.length - 1;
  const alpha = (alphaDeg * Math.PI) / 180;
  const ua = Math.cos(alpha);
  const va = Math.sin(alpha);
  const xa = new Float64Array(N), ya = new Float64Array(N), len = new Float64Array(N);
  const cosT = new Float64Array(N), sinT = new Float64Array(N);
  const xc = new Float64Array(N), yc = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const [x0, y0] = loop[j];
    const [x1, y1] = loop[j + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    xa[j] = x0;
    ya[j] = y0;
    len[j] = L;
    cosT[j] = (x1 - x0) / L;
    sinT[j] = (y1 - y0) / L;
    xc[j] = 0.5 * (x0 + x1);
    yc[j] = 0.5 * (y0 + y1);
  }

  const n = N + 1;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  // Tangential influence rows kept for the Kutta condition and surface velocity.
  const At = new Float64Array(N * n);
  const tmp = new Float64Array(4);
  for (let i = 0; i < N; i++) {
    const nx = -sinT[i], ny = cosT[i];
    const tx = cosT[i], ty = sinT[i];
    let vortN = 0, vortT = 0;
    for (let j = 0; j < N; j++) {
      influence(xc[i], yc[i], xa[j], ya[j], len[j], cosT[j], sinT[j], i === j, tmp);
      A[i * n + j] = tmp[0] * nx + tmp[1] * ny;
      At[i * n + j] = tmp[0] * tx + tmp[1] * ty;
      vortN += tmp[2] * nx + tmp[3] * ny;
      vortT += tmp[2] * tx + tmp[3] * ty;
    }
    A[i * n + N] = vortN;
    At[i * n + N] = vortT;
    b[i] = -(ua * nx + va * ny);
  }
  // Kutta: vt(first) + vt(last) = 0
  for (let j = 0; j <= N; j++) A[N * n + j] = At[0 * n + j] + At[(N - 1) * n + j];
  b[N] = -(ua * cosT[0] + va * sinT[0] + ua * cosT[N - 1] + va * sinT[N - 1]);

  const sol = solveDense(A, b, n);
  const sigma = sol.subarray(0, N);
  const gamma = sol[N];

  const vt = new Float64Array(N);
  const cp = new Float64Array(N);
  let fx = 0, fy = 0, m = 0;
  for (let i = 0; i < N; i++) {
    let s = ua * cosT[i] + va * sinT[i];
    for (let j = 0; j <= N; j++) s += At[i * n + j] * sol[j];
    vt[i] = s;
    cp[i] = 1 - s * s;
    // Force from pressure: -Cp * n * ds
    const nx = -sinT[i], ny = cosT[i];
    const dfx = -cp[i] * nx * len[i];
    const dfy = -cp[i] * ny * len[i];
    fx += dfx;
    fy += dfy;
    m += (xc[i] - 0.25) * dfy - yc[i] * dfx; // about quarter chord, nose-up positive -> negated below
  }
  const cl = fy * ua - fx * va;
  return { xa, ya, len, cosT, sinT, xc, yc, sigma: Float64Array.from(sigma), gamma, vt, cp, alpha, cl, cm: -m };
}

/**
 * Induced + freestream velocity (normalized by U_inf) at an arbitrary point. `freeAlpha`
 * (radians) overrides the freestream direction, for solutions solved at an effective angle.
 */
export function velocityAt(
  s: PanelSolution,
  px: number,
  py: number,
  tmp = new Float64Array(4),
  freeAlpha = s.alpha,
): [number, number] {
  let u = Math.cos(freeAlpha);
  let v = Math.sin(freeAlpha);
  const N = s.len.length;
  for (let j = 0; j < N; j++) {
    influence(px, py, s.xa[j], s.ya[j], s.len[j], s.cosT[j], s.sinT[j], false, tmp);
    u += s.sigma[j] * tmp[0] + s.gamma * tmp[2];
    v += s.sigma[j] * tmp[1] + s.gamma * tmp[3];
  }
  return [u, v];
}

export function pointInPolygon(px: number, py: number, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
