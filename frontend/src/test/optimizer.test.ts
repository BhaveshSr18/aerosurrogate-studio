import { describe, expect, it } from "vitest";
import { runOptimization, topCandidates } from "@/lib/optimizer/engine";
import { quickCoefficients } from "@/lib/physics/mock-model";
import type { GenerationUpdate, ObjectiveKind, OptimizationConfig } from "@/lib/types";

const config = (objective: ObjectiveKind, patch: Partial<OptimizationConfig> = {}): OptimizationConfig => ({
  family: "4",
  objective,
  targetCl: 0.6,
  robustBand: 2,
  uncertaintyPenalty: 0,
  variables: [
    { key: "M", label: "M", unit: "", enabled: true, min: 0, max: 7, fixed: 2 },
    { key: "P", label: "P", unit: "", enabled: true, min: 1, max: 7, fixed: 4 },
    { key: "T", label: "T", unit: "", enabled: true, min: 8, max: 18, fixed: 12 },
    { key: "aoa", label: "aoa", unit: "", enabled: true, min: 0, max: 10, fixed: 4 },
  ],
  speed: 50,
  reflex: 0,
  constraints: { minThickness: 10, maxAbsCm: null, stayInEnvelope: true },
  algorithm: objective === "pareto_ld_cl" ? "nsga2" : "ga",
  populationSize: 24,
  generations: 12,
  seed: 3,
  ...patch,
});

async function run(cfg: OptimizationConfig) {
  let last: GenerationUpdate | undefined;
  for await (const u of runOptimization(cfg, (d) => quickCoefficients(d))) last = u;
  return last!;
}

describe("optimizer", () => {
  it("is reproducible for a given seed", async () => {
    const a = await run(config("max_ld"));
    const b = await run(config("max_ld"));
    expect(a.best.x).toEqual(b.best.x);
    expect(a.history.map((h) => h.best)).toEqual(b.history.map((h) => h.best));
  });

  it("improves monotonically and respects bounds and constraints", async () => {
    const r = await run(config("max_ld"));
    for (let i = 1; i < r.history.length; i++) expect(r.history[i].best).toBeLessThanOrEqual(r.history[i - 1].best + 1e-12);
    expect(-r.history.at(-1)!.best).toBeGreaterThan(-r.history[0].best);
    for (const c of r.population) {
      expect(c.design.naca4.T).toBeGreaterThanOrEqual(8);
      expect(c.design.naca4.T).toBeLessThanOrEqual(18);
      expect(c.design.aoa).toBeGreaterThanOrEqual(0);
      expect(c.design.aoa).toBeLessThanOrEqual(10);
    }
    expect(r.best.feasible).toBe(true);
    expect(r.best.design.naca4.T).toBeGreaterThanOrEqual(10);
  });

  it("holds the lift target when minimizing drag", async () => {
    const r = await run(config("min_cd_at_cl", { targetCl: 0.8 }));
    expect(r.best.feasible).toBe(true);
    expect(Math.abs(r.best.cl - 0.8)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it("enforces a pitching-moment limit", async () => {
    const r = await run(config("max_cl", { constraints: { minThickness: 10, maxAbsCm: 0.05, stayInEnvelope: true } }));
    expect(r.best.feasible).toBe(true);
    expect(Math.abs(r.best.cm)).toBeLessThanOrEqual(0.05);
  });

  it("returns a non-dominated, Cl-sorted Pareto front", async () => {
    const r = await run(config("pareto_ld_cl"));
    const front = r.pareto!;
    expect(front.length).toBeGreaterThan(2);
    for (let i = 1; i < front.length; i++) expect(front[i].cl).toBeGreaterThanOrEqual(front[i - 1].cl);
    for (const a of front)
      for (const b of front) if (a !== b) expect(b.ld >= a.ld && b.cl >= a.cl && (b.ld > a.ld || b.cl > a.cl)).toBe(false);
  });

  it("lists distinct top candidates", async () => {
    const r = await run(config("max_ld"));
    const top = topCandidates(r.population);
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) expect(top[i].objectives[0]).toBeGreaterThanOrEqual(top[i - 1].objectives[0]);
  });
});
