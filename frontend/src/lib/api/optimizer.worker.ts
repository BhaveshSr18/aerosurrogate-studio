/// <reference lib="webworker" />
import { runOptimization, topCandidates } from "../optimizer/engine";
import { quickCoefficients } from "../physics/mock-model";
import type { Candidate, OptimizationConfig } from "../types";

/**
 * The search scores candidates on a coarse panel discretisation for speed. The designs the UI
 * reports are re-scored at the Studio's resolution so their numbers match what the Studio,
 * Polars and Compare pages show for the same design.
 */
const rescore = (c: Candidate): Candidate => {
  const q = quickCoefficients(c.design, 80);
  return { ...c, cl: q.cl, cd: q.cd, cm: q.cm, ld: q.ld };
};

self.onmessage = async (e: MessageEvent<OptimizationConfig>) => {
  const cfg = e.data;
  let last;
  for await (const update of runOptimization(cfg, (d) => quickCoefficients(d))) {
    last = update;
    (self as unknown as Worker).postMessage({ type: "progress", update });
  }
  if (last) {
    const result = {
      ...last,
      best: rescore(last.best),
      pareto: last.pareto?.map(rescore),
      top: topCandidates(last.population).map(rescore),
      config: cfg,
    };
    (self as unknown as Worker).postMessage({ type: "done", result });
  }
};
