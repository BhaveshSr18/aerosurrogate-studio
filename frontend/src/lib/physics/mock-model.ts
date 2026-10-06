/**
 * MOCK surrogate. It stands in for the MeshGraphNet surrogate until a trained checkpoint
 * and the FastAPI backend exist. It combines:
 *   - an inviscid Hess-Smith panel solution (Cp, circulation, velocity field),
 *   - empirical viscous corrections (skin friction, form factor, decambering, soft stall),
 *   - a heuristic uncertainty that grows toward the envelope edge and past stall,
 *   - synthetic wake / boundary-layer fields for Ux and nu_t visuals.
 *
 * The empirical constants are calibrated against the AirfRANS k-omega SST ground truth of
 * the base-mesh cases in backend/data/base_meshes (integrated pressure + wall-shear forces,
 * surface Cp, wake deficit and nu_t), so the placeholder numbers sit close to what the
 * trained surrogate should reproduce. Every number is still a placeholder and is labelled
 * as such in the UI.
 */
import type { Design, FieldData, MeshMorphInfo, PolarPoint, Point, Prediction } from "../types";
import { geometry, thicknessRatio } from "./naca";
import { pointInPolygon, solvePanels, velocityAt, type PanelSolution } from "./panel";
import { DEFAULT_ENVELOPE, envelopeChecks, envelopeDistance, mach, reynolds } from "./envelope";

export const MOCK_MODEL_VERSION = "mock-panel-0.2";

/** Reynolds number of the AirfRANS calibration cases (U ~ 31.5 m/s, c = 1 m). */
const RE_CAL = 2.03e6;
/** Sectional drag of a typical attached calibration case; scales wake depth, width and nu_t. */
const CD_REF = 0.0105;
/** sep factor at which the soft-stall curve peaks (Cl = Clmax): past it the section is stalled. */
const SEP_STALL = 0.3;

interface Coeffs {
  cl: number;
  cd: number;
  cm: number;
  clPressure: number;
  clViscous: number;
  cdPressure: number;
  cdViscous: number;
  sepFactor: number;
  stalled: boolean;
  clSigma: number;
  cdSigma: number;
}

const camberParam = (d: Design) => (d.family === "4" ? d.naca4.M : d.naca5.L);

function clMaxFor(design: Design, Re: number) {
  // Fully turbulent RANS (SST) stalls late: a 12 % section reaches Clmax ~ 1.6 near 16-17 deg,
  // thin sections lose a little, thick ones a little more; camber and Reynolds number add lift.
  const t = thicknessRatio(design);
  const base = t < 0.12 ? 1.62 - 35 * (0.12 - t) ** 2 : 1.62 - 15 * (t - 0.12) ** 2;
  const camberBonus = design.family === "4" ? 0.055 * design.naca4.M : 0.06 * design.naca5.L;
  const reFactor = (Re / 3e6) ** 0.06;
  return { pos: (base + camberBonus) * reFactor, neg: -(base * 0.9 - camberBonus * 0.6) * reFactor };
}

function softStall(clLin: number, clMax: number) {
  const s = Math.sign(clLin) || 1;
  const x = Math.abs(clLin);
  const cmax = Math.abs(clMax);
  const knee = 0.82 * cmax;
  if (x <= knee) return { cl: clLin, sep: 0 };
  const w = cmax - knee;
  let y = knee + w * Math.tanh((x - knee) / w);
  const over = Math.max(0, x - 1.12 * cmax);
  y -= 0.55 * over;
  return { cl: s * y, sep: (x - knee) / cmax };
}

/** Viscous lift factor: boundary-layer decambering grows with thickness and falls with Re. */
const liftFactor = (t: number, Re: number) => 1 - 1.15 * t * (Re / RE_CAL) ** -0.2;

function coefficients(design: Design, nSide?: number) {
  // A camber peak near the nose bends the leading edge sharply; the coarse discretisation used
  // by the optimizer cannot resolve it, so such shapes always get the full resolution.
  if (design.family === "4" && design.naca4.M > 0 && design.naca4.P > 0 && design.naca4.P < 1.5) nSide = Math.max(nSide ?? 80, 80);
  const geo = geometry(design, nSide);
  const panel = solvePanels(geo.loop, design.aoa);
  const t = thicknessRatio(design);
  const Re = reynolds(design.speed);
  const clMax = clMaxFor(design, Re);
  const clLin = liftFactor(t, Re) * panel.cl;
  const { cl, sep } = softStall(clLin, clLin >= 0 ? clMax.pos : clMax.neg);

  // Drag: turbulent flat-plate friction with a thickness correction, a form (pressure) drag,
  // a lift-dependent part and a separation term that only grows quickly once past Clmax.
  const cf2 = (2 * 0.074) / Re ** 0.2;
  const cdViscous = cf2 * (0.893 + 0.66 * t);
  const cdForm = cf2 * (1.7 * t + 60 * t ** 4);
  // Separation drag saturates at the fully separated (flat-plate) limit, Cd ~ 1.8 sin^2 of the
  // angle from zero lift; the quadratic growth alone would be unbounded deep in stall.
  const alphaRel = (Math.abs(panel.cl) / 0.11) * (Math.PI / 180);
  const cdSepMax = 1.8 * Math.sin(Math.min(Math.PI / 2, alphaRel)) ** 2 + 1e-3;
  const cdSep = cdSepMax * Math.tanh((0.15 * sep ** 2 + Math.max(0, sep - 0.25) ** 2) / cdSepMax);
  const cdPressure = cdForm + 0.0038 * cl * cl + cdSep;
  const cd = cdViscous + cdPressure;
  // Viscous relief of the (inviscid, too negative) pitching moment grows with lift and
  // thickness; past the lift peak the moment breaks nose-down.
  const cm = panel.cm + cl * (0.013 + 7 * t ** 3) - 0.12 * Math.max(0, sep - 0.2);

  const d = envelopeDistance(design);
  const clSigma = 0.008 + 0.025 * d * d + 0.06 * sep;
  const cdSigma = cd * (0.035 + 0.06 * d * d + 0.35 * sep);
  const c: Coeffs = {
    cl,
    cd,
    cm,
    clPressure: cl * 0.997,
    clViscous: cl * 0.003,
    cdPressure,
    cdViscous,
    sepFactor: sep,
    stalled: sep > SEP_STALL,
    clSigma,
    cdSigma,
  };
  return { ...c, panel, geo, Re, t };
}

type Solved = ReturnType<typeof coefficients>;

/**
 * Surface pressure consistent with the viscous lift: the panel solution is re-solved at an
 * effective angle (viscous decambering), the trailing-edge pressure is relaxed to the
 * viscous value (RANS gives Cp_TE ~ 0.1-0.3, not the inviscid stagnation value) and, past
 * the stall knee, the upper surface carries a separated pressure plateau.
 */
interface ViscousSurface {
  panel: PanelSolution;
  alphaEff: number;
  /** Modified Cp per panel (same ordering as panel.cp). */
  cp: Float64Array;
  /** Upper-surface separation point (x/c); 1 when attached. */
  xSep: number;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};

function viscousCp(c: Solved, panel: PanelSolution) {
  const N = panel.cp.length;
  const half = N / 2; // panels [0, half) lower TE->LE, [half, N) upper LE->TE
  const cp = Float64Array.from(panel.cp);
  const sep = c.sepFactor;
  const xSep = sep > 0 ? Math.min(0.98, Math.max(0.08, 1 - 1.0 * sep)) : 1;
  const cpTE = Math.min(0.35, Math.max(-1.2, 0.05 + 1.1 * c.t - 0.05 * c.cl - 2.5 * Math.max(0, sep - 0.2)));
  if (sep > 0) {
    // Upper surface: from the separation point the pressure stays nearly flat to the TE.
    let cpS = 0;
    for (let i = half; i < N; i++) if (panel.xc[i] <= xSep) cpS = cp[i];
    for (let i = half; i < N; i++) {
      const x = panel.xc[i];
      if (x > xSep) cp[i] = cpS + (cpTE - cpS) * ((x - xSep) / (1 - xSep)) ** 2;
    }
  }
  for (let i = 0; i < N; i++) {
    const x = panel.xc[i];
    if (i >= half && x > xSep) continue;
    const w = smoothstep(0.88, 1, x);
    cp[i] += w * (cpTE - cp[i]);
  }
  return { cp, xSep };
}

function liftFromCp(panel: PanelSolution, cp: Float64Array, alpha: number) {
  let fx = 0, fy = 0;
  for (let i = 0; i < cp.length; i++) {
    fx += cp[i] * panel.sinT[i] * panel.len[i];
    fy -= cp[i] * panel.cosT[i] * panel.len[i];
  }
  return fy * Math.cos(alpha) - fx * Math.sin(alpha);
}

function viscousSurface(design: Design, c: Solved): ViscousSurface {
  const alpha = (design.aoa * Math.PI) / 180;
  const a1 = solvePanels(c.geo.loop, design.aoa + 1);
  const slope = a1.cl - c.panel.cl; // per degree; the panel method is linear in angle
  const alpha0 = design.aoa - c.panel.cl / slope;
  // Newton on the effective angle so the modified Cp integrates to the reported Cl. The
  // effective angle never exceeds the geometric one (past stall the plateau carries the loss).
  let aeff = alpha0 + c.cl / slope;
  let best: ViscousSurface | null = null;
  for (let it = 0; it < 4; it++) {
    aeff = Math.min(design.aoa, aeff);
    const panel = solvePanels(c.geo.loop, aeff);
    const { cp, xSep } = viscousCp(c, panel);
    best = { panel, alphaEff: aeff, cp, xSep };
    const err = liftFromCp(panel, cp, alpha) - c.cl;
    if (Math.abs(err) < 2e-3 || aeff >= design.aoa) break;
    aeff -= err / slope;
  }
  return best!;
}

function hashDesign(d: Design) {
  const s = JSON.stringify(d);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function mockMesh(design: Design): MeshMorphInfo {
  // Placeholder for the Phase 1 mesh-morphing result: the nearest AirfRANS base shape.
  const t = thicknessRatio(design) * 100;
  const baseT = Math.min(20, Math.max(5, Math.round(t / 3) * 3));
  const disp = Math.abs(t - baseT) / 100 / 2 + camberParam(design) * 0.0008;
  return {
    baseCase: `airFoil2D_SST_…_${design.family === "4" ? `${Math.round(design.naca4.M)}_${Math.round(design.naca4.P)}_${baseT}` : `${Math.round(design.naca5.L)}_${Math.round(design.naca5.P)}_${design.naca5.Q}_${baseT}`}`,
    shapeDistance: Number((Math.abs(t - baseT) / 10).toFixed(3)),
    maxSurfaceDisplacement: disp,
    minCellQuality: 0.62 - disp * 3,
    nodes: 178_000 + Math.round(disp * 2e5),
    status: disp > 0.02 ? "warn" : "pass",
  };
}

export function predictMock(design: Design): Prediction {
  const t0 = performance.now();
  const c = coefficients(design);
  const vs = viscousSurface(design, c);
  const n = vs.cp.length;
  // Split control points into lower (first half, TE->LE) and upper (LE->TE).
  const half = n / 2;
  const x: number[] = [];
  const cpUpper: number[] = [];
  const cpLower: number[] = [];
  for (let k = 0; k < half; k++) {
    const iu = half + k;
    const il = half - 1 - k;
    x.push(vs.panel.xc[iu]);
    cpUpper.push(vs.cp[iu]);
    cpLower.push(vs.cp[il]);
  }
  const ld = c.cl / c.cd;
  const ldSigma = Math.abs(ld) * Math.sqrt((c.clSigma / Math.max(1e-3, Math.abs(c.cl))) ** 2 + (c.cdSigma / c.cd) ** 2);
  return {
    id: hashDesign(design),
    design,
    reynolds: c.Re,
    mach: mach(design.speed),
    cl: c.cl,
    cd: c.cd,
    cm: c.cm,
    ld,
    clPressure: c.clPressure,
    clViscous: c.clViscous,
    cdPressure: c.cdPressure,
    cdViscous: c.cdViscous,
    uncertainty: { cl: c.clSigma, cd: c.cdSigma, ld: ldSigma },
    envelope: envelopeChecks(design, DEFAULT_ENVELOPE),
    mesh: mockMesh(design),
    surface: { x, cpUpper, cpLower },
    stalled: c.stalled,
    timingMs: performance.now() - t0,
    modelVersion: MOCK_MODEL_VERSION,
  };
}

/** Coefficients only (no surface/field) — the hot path for sweeps and the optimizer. */
export function quickCoefficients(design: Design, nSide = 44) {
  const c = coefficients(design, nSide);
  return { cl: c.cl, cd: c.cd, cm: c.cm, ld: c.cl / c.cd, clSigma: c.clSigma, cdSigma: c.cdSigma, stalled: c.stalled };
}

export function sweepMock(design: Design, aoas: number[]): PolarPoint[] {
  return aoas.map((aoa) => {
    const q = quickCoefficients({ ...design, aoa }, 80);
    return { aoa, cl: q.cl, cd: q.cd, cm: q.cm, ld: q.ld, clSigma: q.clSigma, cdSigma: q.cdSigma, stalled: q.stalled };
  });
}

export interface FieldWindow {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  nx: number;
}

export const NEAR_WINDOW: FieldWindow = { xmin: -0.6, xmax: 1.8, ymin: -0.6, ymax: 0.6, nx: 260 };
export const WAKE_WINDOW: FieldWindow = { xmin: -0.5, xmax: 3.5, ymin: -1.0, ymax: 1.0, nx: 260 };

/** Camber-line height at x (linear interpolation on the geometry's camber samples). */
function camberAt(camber: Point[], x: number) {
  if (x <= camber[0][0]) return camber[0][1];
  for (let i = 1; i < camber.length; i++) {
    if (camber[i][0] >= x) {
      const [x0, y0] = camber[i - 1];
      const [x1, y1] = camber[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return camber[camber.length - 1][1];
}

export function fieldMock(design: Design, win: FieldWindow = NEAR_WINDOW): FieldData {
  const c = coefficients(design);
  const vs = viscousSurface(design, c);
  const { geo } = c;
  const nx = win.nx;
  const ny = Math.round((nx * (win.ymax - win.ymin)) / (win.xmax - win.xmin));
  const N = nx * ny;
  const cp = new Float32Array(N), umag = new Float32Array(N), ux = new Float32Array(N);
  const uy = new Float32Array(N), nut = new Float32Array(N), u = new Float32Array(N), v = new Float32Array(N);
  const U = design.speed;
  const a = (design.aoa * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const te = geo.loop[0];
  const tmp = new Float64Array(4);
  const sep = c.sepFactor;
  const surf = geo.loop;

  // Wake and boundary-layer scales, calibrated on the AirfRANS SST cases (Re ~ 2e6):
  // centreline deficit ~0.5 at 0.05 c behind the TE, ~0.3 at 0.25 c, ~0.14 at 1 c;
  // half-width ~0.011 c growing to ~0.025 c; nu_t/nu ~ 250-450 (x3-4 near stall).
  const reScale = c.Re / RE_CAL;
  const cdR = Math.min(20, c.cd / CD_REF);
  const D0 = 0.81 * Math.sqrt(cdR);
  const bScale = Math.sqrt(cdR) * reScale ** -0.1;
  const nutPeak = 330 * reScale * cdR ** 1.5;

  for (let j = 0; j < ny; j++) {
    const y = win.ymin + ((j + 0.5) / ny) * (win.ymax - win.ymin);
    for (let i = 0; i < nx; i++) {
      const x = win.xmin + ((i + 0.5) / nx) * (win.xmax - win.xmin);
      const k = j * nx + i;
      if (x > -0.01 && x < 1.01 && Math.abs(y) < 0.25 && pointInPolygon(x, y, surf)) {
        cp[k] = umag[k] = ux[k] = uy[k] = nut[k] = NaN;
        u[k] = v[k] = 0;
        continue;
      }
      // Induced velocity of the effective-angle solution in the true freestream.
      let [vu, vv] = velocityAt(vs.panel, x, y, tmp, a);
      // Pressure follows the potential solution (static pressure is ~continuous across wake/BL).
      const cpInviscid = 1 - (vu * vu + vv * vv);
      let nutv = 0;

      // Near-wall turbulent boundary layer (1/7-power profile; separated shear layer past xSep).
      // Both fade out just behind the trailing edge, where the wake model takes over.
      if (x > -0.08 && x < 1.25 && Math.abs(y) < 0.5) {
        let dmin = 1e9, xs = 0;
        for (let p = 0; p < surf.length; p++) {
          const d = (x - surf[p][0]) ** 2 + (y - surf[p][1]) ** 2;
          if (d < dmin) {
            dmin = d;
            xs = surf[p][0];
          }
        }
        const dist = Math.sqrt(dmin);
        const xe = Math.max(0.002, xs);
        const upper = y >= camberAt(geo.camber, Math.min(1, Math.max(0, x)));
        const load = upper ? Math.max(0, c.cl) : Math.max(0, -c.cl);
        const wSep = upper && sep > 0 ? Math.min(1, Math.max(0, (xs - vs.xSep) / 0.1)) : 0;
        let delta = 0.37 * xe * (c.Re * xe) ** -0.2 * (1 + 0.6 * load * xe) + 0.0015;
        if (wSep > 0) delta += 0.45 * (xs - vs.xSep) * Math.min(1, sep / SEP_STALL);
        const fadeTE = x > 1 ? Math.exp(-(((x - 1) / Math.max(0.04, 1.5 * delta)) ** 2)) : 1;
        const r = dist / delta;
        if (r < 1) {
          const fAtt = r ** (1 / 7);
          const fSep = r < 0.35 ? -0.12 * Math.sin((Math.PI * r) / 0.35) : Math.sqrt((r - 0.35) / 0.65);
          const f = 1 + ((1 - wSep) * fAtt + wSep * fSep - 1) * fadeTE;
          vu *= f;
          vv *= f;
        }
        const rb = r / 0.4;
        nutv += nutPeak * 0.9 * xe ** 0.8 * rb * Math.exp(1 - rb) * fadeTE;
      }

      // Turbulent wake along the freestream direction from the trailing edge.
      const sx = (x - te[0]) * ca + (y - te[1]) * sa;
      const sn = -(x - te[0]) * sa + (y - te[1]) * ca;
      if (sx > -0.02) {
        const s = Math.max(0, sx);
        const b = (0.01 + 0.013 * Math.sqrt(s)) * bScale * (1 + 1.5 * Math.max(0, sep - 0.2));
        const w = b / 0.8326; // Gaussian e-folding width from the half-width
        const fade = sx < 0 ? Math.exp(-((sx / 0.01) ** 2)) : 1;
        const g = Math.exp(-((sn / w) ** 2)) * fade;
        const D = Math.min(0.98, D0 / Math.sqrt(1 + 25.5 * s));
        // Blend toward the wake centreline velocity (1 - D) U along the freestream.
        vu += g * ((1 - D) * ca - vu);
        vv += g * ((1 - D) * sa - vv);
        const gn = Math.exp(-((sn / (1.4 * w)) ** 2)) * fade;
        nutv = Math.max(nutv, nutPeak * (0.75 + 0.25 * Math.min(1, s / 0.25)) * gn);
      }

      const m2 = vu * vu + vv * vv;
      cp[k] = cpInviscid;
      umag[k] = Math.sqrt(m2);
      ux[k] = vu * U;
      uy[k] = vv * U;
      nut[k] = nutv; // nu_t / nu
      u[k] = vu;
      v[k] = vv;
    }
  }
  return { nx, ny, xmin: win.xmin, xmax: win.xmax, ymin: win.ymin, ymax: win.ymax, vars: { cp, umag, ux, uy, nut }, u, v, speed: U };
}

