import { describe, expect, it } from "vitest";
import truth from "./fixtures/airfrans-truth.json";
import { fieldMock, predictMock, quickCoefficients, sweepMock } from "@/lib/physics/mock-model";
import { DEFAULT_ENVELOPE } from "@/lib/physics/envelope";
import { PRESETS } from "@/lib/presets";
import type { Design } from "@/lib/types";

type Case = (typeof truth.cases)[number];

const designOf = (t: Case): Design => {
  const [a, b, c, d] = t.naca;
  return t.family === "4"
    ? { family: "4", naca4: { M: a, P: b, T: c }, naca5: { L: 2, P: 3, Q: 0, T: 12 }, aoa: t.aoa, speed: t.U }
    : { family: "5", naca4: { M: 2, P: 4, T: 12 }, naca5: { L: a, P: b, Q: c === 1 ? 1 : 0, T: d }, aoa: t.aoa, speed: t.U };
};

const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] >= x) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};

describe("placeholder physics vs AirfRANS ground truth", () => {
  const preds = truth.cases.map((t) => ({ t, p: predictMock(designOf(t)) }));

  it("integrated coefficients stay calibrated", () => {
    const n = preds.length;
    const clMae = preds.reduce((s, { t, p }) => s + Math.abs(p.cl - t.cl), 0) / n;
    const cdMape = preds.reduce((s, { t, p }) => s + Math.abs(p.cd - t.cd) / t.cd, 0) / n;
    const cmMae = preds.reduce((s, { t, p }) => s + Math.abs(p.cm - t.cm), 0) / n;
    expect(clMae).toBeLessThan(0.03);
    expect(cdMape).toBeLessThan(0.05);
    expect(cmMae).toBeLessThan(0.01);
    for (const { t, p } of preds) {
      expect(Math.abs(p.cl - t.cl), t.designation).toBeLessThan(0.06);
      expect(Math.abs(p.cd - t.cd) / t.cd, t.designation).toBeLessThan(0.12);
    }
  });

  it("surface Cp follows the CFD distribution", () => {
    let se = 0;
    let n = 0;
    for (const { t, p } of preds) {
      t.cp.x.forEach((x, i) => {
        if (x < 0.01) return;
        se += (interp(p.surface.x, p.surface.cpUpper, x) - t.cp.upper[i]) ** 2 + (interp(p.surface.x, p.surface.cpLower, x) - t.cp.lower[i]) ** 2;
        n += 2;
      });
    }
    expect(Math.sqrt(se / n)).toBeLessThan(0.08);
  });

  it("wake deficit and eddy viscosity match the CFD wake", () => {
    let dErr = 0;
    let nErr = 0;
    let k = 0;
    for (const { t } of preds) {
      const d = designOf(t);
      const f = fieldMock(d);
      const a = (d.aoa * Math.PI) / 180;
      for (const [s, w] of Object.entries(t.wake)) {
        let umin = Infinity;
        let nutmax = 0;
        for (let n = -0.3; n <= 0.3; n += 0.0025) {
          const x = 1 + Number(s) * Math.cos(a) - n * Math.sin(a);
          const y = Number(s) * Math.sin(a) + n * Math.cos(a);
          const i = Math.floor(((x - f.xmin) / (f.xmax - f.xmin)) * f.nx);
          const j = Math.floor(((y - f.ymin) / (f.ymax - f.ymin)) * f.ny);
          if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) continue;
          const q = j * f.nx + i;
          umin = Math.min(umin, f.u[q] * Math.cos(a) + f.v[q] * Math.sin(a));
          nutmax = Math.max(nutmax, f.vars.nut[q]);
        }
        dErr += Math.abs(1 - umin - w.deficit) / w.deficit;
        nErr += Math.abs(nutmax - w.nut_ratio) / w.nut_ratio;
        k++;
      }
    }
    expect(dErr / k).toBeLessThan(0.1);
    expect(nErr / k).toBeLessThan(0.15);
  });
});

describe("physical behaviour", () => {
  const base = PRESETS[0].design; // NACA 0012

  it("symmetric section: odd lift, zero lift and moment at zero incidence", () => {
    const p = quickCoefficients({ ...base, aoa: 0 }, 80);
    expect(Math.abs(p.cl)).toBeLessThan(1e-6);
    expect(Math.abs(p.cm)).toBeLessThan(1e-3);
    const up = quickCoefficients({ ...base, aoa: 6 }, 80);
    const dn = quickCoefficients({ ...base, aoa: -6 }, 80);
    expect(up.cl).toBeCloseTo(-dn.cl, 6);
    expect(up.cd).toBeCloseTo(dn.cd, 6);
  });

  it("NACA 0012 matches fully turbulent reference data", () => {
    const re6 = quickCoefficients({ ...base, aoa: 0, speed: 94 }, 80); // Re ~ 6e6
    expect(re6.cd).toBeGreaterThan(0.0072);
    expect(re6.cd).toBeLessThan(0.0088); // NASA TMR SST: 0.0081
    const slope = (quickCoefficients({ ...base, aoa: 4 }, 80).cl - quickCoefficients({ ...base, aoa: 0 }, 80).cl) / 4;
    expect(slope).toBeGreaterThan(0.098);
    expect(slope).toBeLessThan(0.112);
  });

  it("cambered sections: negative zero-lift angle and nose-down moment", () => {
    expect(quickCoefficients({ ...PRESETS[1].design, aoa: -3 }, 80).cl).toBeLessThan(0);
    expect(quickCoefficients({ ...PRESETS[1].design, aoa: 0 }, 80).cl).toBeGreaterThan(0);
    const cm2412 = quickCoefficients({ ...PRESETS[1].design, aoa: 0 }, 80).cm;
    const cm4412 = quickCoefficients({ ...PRESETS[2].design, aoa: 0 }, 80).cm;
    expect(cm2412).toBeLessThan(-0.03);
    expect(cm4412).toBeLessThan(cm2412);
  });

  it("drag falls with Reynolds number", () => {
    const lo = quickCoefficients({ ...base, aoa: 2, speed: 31 }, 80).cd;
    const hi = quickCoefficients({ ...base, aoa: 2, speed: 94 }, 80).cd;
    expect(hi).toBeLessThan(lo);
  });

  it("lift curve is linear, then peaks and is flagged as stalled past Clmax", () => {
    const pts = sweepMock({ ...base, speed: 50 }, Array.from({ length: 26 }, (_, i) => i));
    const iMax = pts.reduce((b, p, i) => (p.cl > pts[b].cl ? i : b), 0);
    expect(pts[iMax].aoa).toBeGreaterThanOrEqual(14);
    expect(pts[iMax].cl).toBeGreaterThan(1.4);
    expect(pts[iMax].cl).toBeLessThan(1.8);
    expect(pts[pts.length - 1].stalled).toBe(true);
    expect(pts[pts.length - 1].cd).toBeGreaterThan(5 * pts[0].cd);
    for (let i = 1; i <= 10; i++) expect(pts[i].cl).toBeGreaterThan(pts[i - 1].cl);
  });
});

describe("robustness across the whole envelope", () => {
  const e = DEFAULT_ENVELOPE;
  const lin = (r: { min: number; max: number }, n: number) => Array.from({ length: n }, (_, i) => r.min + ((r.max - r.min) * i) / (n - 1));

  it("never returns NaN or non-physical coefficients", () => {
    const designs: Design[] = [];
    for (const M of lin(e.naca4.M, 3))
      for (const P of [0, 0.3, 0.8, 1, 4, 7])
        for (const T of lin(e.naca4.T, 3))
          for (const aoa of [e.aoa.min, 5, e.aoa.max, 25])
            for (const speed of [e.speed.min, e.speed.max])
              designs.push({ family: "4", naca4: { M, P, T }, naca5: { L: 2, P: 3, Q: 0, T: 12 }, aoa, speed });
    for (const L of lin(e.naca5.L, 3))
      for (const P of lin(e.naca5.P, 3))
        for (const Q of [0, 1] as const)
          for (const T of [5, 20])
            for (const aoa of [e.aoa.min, e.aoa.max])
              designs.push({ family: "5", naca4: { M: 2, P: 4, T: 12 }, naca5: { L, P, Q, T }, aoa, speed: 50 });
    for (const d of designs) {
      const q = quickCoefficients(d);
      const tag = JSON.stringify(d);
      for (const v of [q.cl, q.cd, q.cm, q.ld, q.clSigma, q.cdSigma]) expect(Number.isFinite(v), tag).toBe(true);
      expect(q.cd, tag).toBeGreaterThan(0.004);
      expect(q.cd, tag).toBeLessThan(1);
      expect(Math.abs(q.cl), tag).toBeLessThan(2.6);
    }
  });

  it("full predictions and fields stay finite at the envelope corners", () => {
    const corners: Design[] = [
      { ...PRESETS[3].design, aoa: 15, speed: 31 },
      { ...PRESETS[0].design, naca4: { M: 7, P: 0.3, T: 5 }, aoa: -5, speed: 94 },
      { ...PRESETS[6].design, naca5: { L: 4, P: 8, Q: 1, T: 20 }, aoa: 15 },
    ];
    for (const d of corners) {
      const p = predictMock(d);
      expect([p.cl, p.cd, p.cm, ...p.surface.cpUpper, ...p.surface.cpLower].every(Number.isFinite)).toBe(true);
      const f = fieldMock(d, { xmin: -0.6, xmax: 1.8, ymin: -0.6, ymax: 0.6, nx: 80 });
      const finite = Array.from(f.vars.umag).filter(Number.isFinite);
      expect(finite.length).toBeGreaterThan(0.9 * f.nx * f.ny);
      expect(Math.max(...finite)).toBeLessThan(4);
    }
  });
});
