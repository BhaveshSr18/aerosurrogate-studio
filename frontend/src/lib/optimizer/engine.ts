/**
 * Real-coded GA (single objective) and NSGA-II (two objectives) with constraint
 * domination. The evaluator is injected, so the same engine runs against the mock
 * physics now and against the batched surrogate endpoint later (roadmap Phase 3 will
 * move the production optimizer into the Python worker with pymoo; this engine is
 * the in-browser preview).
 */
import type { Candidate, Design, GenerationUpdate, OptimizationConfig, VariableSpec } from "../types";
import { rng } from "../utils";

export type Evaluator = (d: Design) => { cl: number; cd: number; cm: number; ld: number; clSigma: number; cdSigma: number; stalled: boolean };

export const OBJECTIVE_META: Record<
  OptimizationConfig["objective"],
  { label: string; short: string; unit: string; sign: 1 | -1; multi: boolean; description: string }
> = {
  max_ld: { label: "Maximize L/D", short: "L/D", unit: "", sign: -1, multi: false, description: "Highest lift-to-drag ratio at the design point." },
  min_cd_at_cl: { label: "Minimize Cd at target Cl", short: "Cd", unit: "", sign: 1, multi: false, description: "Lowest drag while holding the lift coefficient at a target value." },
  max_cl: { label: "Maximize Cl", short: "Cl", unit: "", sign: -1, multi: false, description: "Highest lift coefficient (watch the stall indicator)." },
  robust_ld: { label: "Robust L/D over AoA band", short: "mean L/D", unit: "", sign: -1, multi: false, description: "Best mean L/D across AoA − band, AoA, AoA + band." },
  pareto_ld_cl: { label: "Pareto: L/D vs Cl", short: "L/D", unit: "", sign: -1, multi: true, description: "Trade-off front between efficiency (L/D) and lift (Cl), NSGA-II." },
};

export function decode(cfg: OptimizationConfig, x: number[]): Design {
  const vals: Record<string, number> = {};
  let k = 0;
  for (const v of cfg.variables) vals[v.key] = v.enabled ? x[k++] : v.fixed;
  return {
    family: cfg.family,
    naca4: { M: vals.M ?? 2, P: vals.P ?? 4, T: vals.T ?? 12 },
    naca5: { L: vals.L ?? 2, P: vals.P ?? 3, Q: cfg.reflex, T: vals.T ?? 12 },
    aoa: vals.aoa ?? 4,
    speed: cfg.speed,
  };
}

function evaluate(cfg: OptimizationConfig, evalFn: Evaluator, x: number[]): Candidate {
  const design = decode(cfg, x);
  const q = evalFn(design);
  const k = cfg.uncertaintyPenalty;
  const ldSigma = Math.abs(q.ld) * Math.hypot(q.clSigma / Math.max(1e-3, Math.abs(q.cl)), q.cdSigma / q.cd);
  let objectives: number[];
  let violation = 0;
  switch (cfg.objective) {
    case "max_ld":
      objectives = [-(q.ld - k * ldSigma)];
      break;
    case "min_cd_at_cl":
      objectives = [q.cd + k * q.cdSigma];
      violation += Math.max(0, Math.abs(q.cl - cfg.targetCl) - 0.02) * 10;
      break;
    case "max_cl":
      objectives = [-(q.cl - k * q.clSigma)];
      break;
    case "robust_ld": {
      const b = cfg.robustBand;
      const lo = evalFn({ ...design, aoa: design.aoa - b });
      const hi = evalFn({ ...design, aoa: design.aoa + b });
      objectives = [-((lo.ld + q.ld + hi.ld) / 3 - k * ldSigma)];
      break;
    }
    case "pareto_ld_cl":
      objectives = [-q.ld, -q.cl];
      break;
  }
  const t = cfg.family === "4" ? design.naca4.T : design.naca5.T;
  violation += Math.max(0, cfg.constraints.minThickness - t) / 10;
  if (cfg.constraints.maxAbsCm != null) violation += Math.max(0, Math.abs(q.cm) - cfg.constraints.maxAbsCm) * 5;
  return { design, x, cl: q.cl, cd: q.cd, cm: q.cm, ld: q.ld, objectives, violation, feasible: violation <= 1e-9 };
}

/** Constraint-domination (Deb): feasible first, then lower violation, then Pareto dominance. */
function dominates(a: Candidate, b: Candidate) {
  if (a.feasible && !b.feasible) return true;
  if (!a.feasible && !b.feasible) return a.violation < b.violation;
  if (!a.feasible) return false;
  let better = false;
  for (let i = 0; i < a.objectives.length; i++) {
    if (a.objectives[i] > b.objectives[i]) return false;
    if (a.objectives[i] < b.objectives[i]) better = true;
  }
  return better;
}

function nonDominatedSort(pop: Candidate[]): Candidate[][] {
  const S: number[][] = pop.map(() => []);
  const n = new Array(pop.length).fill(0);
  const fronts: number[][] = [[]];
  for (let p = 0; p < pop.length; p++) {
    for (let q = 0; q < pop.length; q++) {
      if (p === q) continue;
      if (dominates(pop[p], pop[q])) S[p].push(q);
      else if (dominates(pop[q], pop[p])) n[p]++;
    }
    if (n[p] === 0) {
      pop[p].rank = 0;
      fronts[0].push(p);
    }
  }
  let i = 0;
  while (fronts[i].length) {
    const next: number[] = [];
    for (const p of fronts[i]) for (const q of S[p]) if (--n[q] === 0) {
      pop[q].rank = i + 1;
      next.push(q);
    }
    fronts.push(next);
    i++;
  }
  return fronts.filter((f) => f.length).map((f) => f.map((k) => pop[k]));
}

function crowding(front: Candidate[]) {
  const d = new Map<Candidate, number>(front.map((c) => [c, 0]));
  const m = front[0]?.objectives.length ?? 0;
  for (let k = 0; k < m; k++) {
    const s = [...front].sort((a, b) => a.objectives[k] - b.objectives[k]);
    const span = s[s.length - 1].objectives[k] - s[0].objectives[k] || 1;
    d.set(s[0], Infinity);
    d.set(s[s.length - 1], Infinity);
    for (let i = 1; i < s.length - 1; i++) d.set(s[i], d.get(s[i])! + (s[i + 1].objectives[k] - s[i - 1].objectives[k]) / span);
  }
  return d;
}

function selectSurvivors(pool: Candidate[], size: number, multi: boolean) {
  if (!multi) {
    return [...pool]
      .sort((a, b) => (a.feasible !== b.feasible ? (a.feasible ? -1 : 1) : a.feasible ? a.objectives[0] - b.objectives[0] : a.violation - b.violation))
      .slice(0, size);
  }
  const out: Candidate[] = [];
  for (const front of nonDominatedSort(pool)) {
    if (out.length + front.length <= size) {
      out.push(...front);
    } else {
      const cd = crowding(front);
      out.push(...front.sort((a, b) => cd.get(b)! - cd.get(a)!).slice(0, size - out.length));
      break;
    }
  }
  return out;
}

export async function* runOptimization(
  cfg: OptimizationConfig,
  evalFn: Evaluator,
): AsyncGenerator<GenerationUpdate> {
  const vars: VariableSpec[] = cfg.variables.filter((v) => v.enabled);
  const nv = vars.length;
  const rand = rng(cfg.seed);
  const multi = cfg.objective === "pareto_ld_cl";
  const t0 = performance.now();
  let evals = 0;
  const ev = (x: number[]) => {
    evals += cfg.objective === "robust_ld" ? 3 : 1;
    return evaluate(cfg, evalFn, x);
  };

  // Stratified initial sampling per variable (Latin hypercube).
  const N = cfg.populationSize;
  const perms = vars.map(() => [...Array(N).keys()].sort(() => rand() - 0.5));
  let pop: Candidate[] = [];
  for (let i = 0; i < N; i++) pop.push(ev(vars.map((v, k) => v.min + ((perms[k][i] + rand()) / N) * (v.max - v.min))));
  if (multi) nonDominatedSort(pop);

  const history: GenerationUpdate["history"] = [];
  const better = (a: Candidate, b: Candidate) => {
    if (multi) {
      if ((a.rank ?? 0) !== (b.rank ?? 0)) return (a.rank ?? 0) < (b.rank ?? 0);
      return rand() < 0.5;
    }
    if (a.feasible !== b.feasible) return a.feasible;
    return a.feasible ? a.objectives[0] < b.objectives[0] : a.violation < b.violation;
  };
  const tournament = () => {
    const a = pop[Math.floor(rand() * pop.length)];
    const b = pop[Math.floor(rand() * pop.length)];
    return better(a, b) ? a : b;
  };

  const snapshot = (g: number): GenerationUpdate => {
    const feas = pop.filter((c) => c.feasible);
    const pool = feas.length ? feas : pop;
    const best = [...pool].sort((a, b) => a.objectives[0] - b.objectives[0])[0];
    const mean = pool.reduce((s, c) => s + c.objectives[0], 0) / pool.length;
    history.push({ generation: g, best: best.objectives[0], mean });
    return {
      generation: g,
      evaluations: evals,
      elapsedMs: performance.now() - t0,
      best,
      population: pop,
      history: [...history],
      pareto: multi ? pop.filter((c) => c.rank === 0 && c.feasible).sort((a, b) => a.cl - b.cl) : undefined,
    };
  };

  yield snapshot(0);

  const etaC = 15;
  const etaM = 20;
  for (let g = 1; g <= cfg.generations; g++) {
    const children: Candidate[] = [];
    while (children.length < N) {
      const p1 = tournament().x!;
      const p2 = tournament().x!;
      const c1 = [...p1];
      const c2 = [...p2];
      if (rand() < 0.9) {
        for (let k = 0; k < nv; k++) {
          if (rand() > 0.5 || Math.abs(p1[k] - p2[k]) < 1e-12) continue;
          const u = rand();
          const beta = u <= 0.5 ? (2 * u) ** (1 / (etaC + 1)) : (1 / (2 * (1 - u))) ** (1 / (etaC + 1));
          c1[k] = 0.5 * ((1 + beta) * p1[k] + (1 - beta) * p2[k]);
          c2[k] = 0.5 * ((1 - beta) * p1[k] + (1 + beta) * p2[k]);
        }
      }
      for (const c of [c1, c2]) {
        for (let k = 0; k < nv; k++) {
          if (rand() < 1 / nv) {
            const u = rand();
            const d = u < 0.5 ? (2 * u) ** (1 / (etaM + 1)) - 1 : 1 - (2 * (1 - u)) ** (1 / (etaM + 1));
            c[k] += d * (vars[k].max - vars[k].min);
          }
          c[k] = Math.min(vars[k].max, Math.max(vars[k].min, c[k]));
        }
        children.push(ev(c));
      }
    }
    pop = selectSurvivors([...pop, ...children], N, multi);
    if (multi) nonDominatedSort(pop);
    yield snapshot(g);
  }
}

/** Best feasible designs that differ meaningfully (not the same converged point twice). */
export function topCandidates(pop: Candidate[], n = 5, minGap = 0.15) {
  const out: Candidate[] = [];
  for (const c of [...pop].filter((c) => c.feasible).sort((a, b) => a.objectives[0] - b.objectives[0])) {
    const x = c.x ?? [];
    if (out.some((o) => (o.x ?? []).every((v, k) => Math.abs(v - x[k]) < minGap))) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}
