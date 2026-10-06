"""Surrogate-in-the-loop airfoil optimization with pymoo (GA / NSGA-II).

Objectives are expressed in "minimize" form, identical to the UI's preview engine
(frontend/src/lib/optimizer/engine.ts), so its convergence plots read the same:
    max_ld        -(L/D - k sigma)
    min_cd_at_cl   Cd + k sigma, with |Cl - target| <= 0.02 as a constraint
    max_cl        -(Cl - k sigma)
    robust_ld     -(mean L/D over AoA - band, AoA, AoA + band - k sigma)
    pareto_ld_cl  [-L/D, -Cl]
Constraints (<= 0): minimum thickness, |Cm| limit, lift target, mesh-quality gate.
"""

from __future__ import annotations

import math
import time
from typing import Callable

import numpy as np
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.algorithms.soo.nonconvex.ga import GA
from pymoo.core.callback import Callback
from pymoo.core.problem import Problem
from pymoo.operators.crossover.sbx import SBX
from pymoo.operators.mutation.pm import PM
from pymoo.operators.sampling.lhs import LHS
from pymoo.optimize import minimize

from aerostudio.api import schemas as S

CL_TOLERANCE = 0.02


class Cancelled(Exception):
    pass


def decode(cfg: S.OptimizationConfig, x: np.ndarray) -> S.Design:
    vals: dict[str, float] = {}
    k = 0
    for v in cfg.variables:
        if v.enabled:
            vals[v.key] = float(x[k])
            k += 1
        else:
            vals[v.key] = v.fixed
    return S.Design(
        family=cfg.family,
        naca4=S.Naca4(M=vals.get("M", 2.0), P=vals.get("P", 4.0), T=vals.get("T", 12.0)),
        naca5=S.Naca5(L=vals.get("L", 2.0), P=vals.get("P", 3.0), Q=cfg.reflex, T=vals.get("T", 12.0)),
        aoa=vals.get("aoa", 4.0),
        speed=cfg.speed,
    )


class AirfoilProblem(Problem):
    def __init__(self, cfg: S.OptimizationConfig, evaluate: Callable[[S.Design], dict], should_stop: Callable[[], bool]):
        enabled = [v for v in cfg.variables if v.enabled]
        self.cfg = cfg
        self._eval = evaluate
        self._stop = should_stop
        self.records: dict[tuple, S.Candidate] = {}
        self.g: dict[tuple, list[float]] = {}
        self.evaluations = 0
        multi = cfg.objective == "pareto_ld_cl"
        super().__init__(
            n_var=len(enabled), n_obj=2 if multi else 1, n_ieq_constr=4,
            xl=np.array([v.min for v in enabled]), xu=np.array([v.max for v in enabled]),
        )

    def _evaluate(self, X, out, *args, **kwargs):
        F, G = [], []
        for x in X:
            if self._stop():
                raise Cancelled()
            cand = self.candidate(x)
            F.append(cand.objectives)
            G.append(self.g[tuple(np.round(x, 6))])
        out["F"] = np.asarray(F)
        out["G"] = np.asarray(G)

    def candidate(self, x: np.ndarray) -> S.Candidate:
        key = tuple(np.round(x, 6))
        if key in self.records:
            return self.records[key]
        cfg = self.cfg
        design = decode(cfg, x)
        q = self._eval(design)
        self.evaluations += 1
        k = cfg.uncertainty_penalty
        if cfg.objective == "max_ld":
            obj = [-(q["ld"] - k * q["ldSigma"])]
        elif cfg.objective == "min_cd_at_cl":
            obj = [q["cd"] + k * q["cdSigma"]]
        elif cfg.objective == "max_cl":
            obj = [-(q["cl"] - k * q["clSigma"])]
        elif cfg.objective == "robust_ld":
            lo = self._eval(design.model_copy(update={"aoa": design.aoa - cfg.robust_band}))
            hi = self._eval(design.model_copy(update={"aoa": design.aoa + cfg.robust_band}))
            self.evaluations += 2
            obj = [-((lo["ld"] + q["ld"] + hi["ld"]) / 3 - k * q["ldSigma"])]
        else:
            obj = [-q["ld"], -q["cl"]]
        t = design.naca4.T if design.family == "4" else design.naca5.T
        g = [
            cfg.constraints.min_thickness - t,
            (abs(q["cm"]) - cfg.constraints.max_abs_cm) if cfg.constraints.max_abs_cm is not None else -1.0,
            (abs(q["cl"] - cfg.target_cl) - CL_TOLERANCE) if cfg.objective == "min_cd_at_cl" else -1.0,
            0.0 if q["meshOk"] else 1.0,
        ]
        violation = float(sum(max(0.0, v) for v in g))
        obj = [v if math.isfinite(v) else 1e6 for v in obj]
        cand = S.Candidate(design=design, x=[float(v) for v in x], cl=q["cl"], cd=q["cd"], cm=q["cm"], ld=q["ld"],
                           objectives=obj, violation=violation, feasible=violation <= 1e-9)
        self.records[key] = cand
        self.g[key] = g
        return cand


def _snapshot(problem: AirfoilProblem, pop, generation: int, t0: float, history: list, multi: bool) -> S.GenerationUpdate:
    cands = [problem.candidate(ind.X) for ind in pop]
    if multi:
        ranks = pop.get("rank")
        cands = [c.model_copy(update={"rank": int(r) if r is not None else None}) for c, r in zip(cands, ranks)]
    feas = [c for c in cands if c.feasible] or cands
    best = min(feas, key=lambda c: (c.violation, c.objectives[0]))
    mean = float(np.mean([c.objectives[0] for c in feas]))
    history.append(S.HistoryPoint(generation=generation, best=best.objectives[0], mean=mean))
    pareto = sorted([c for c in cands if c.rank == 0 and c.feasible], key=lambda c: c.cl) if multi else None
    return S.GenerationUpdate(generation=generation, evaluations=problem.evaluations, elapsed_ms=(time.time() - t0) * 1e3,
                              best=best, population=cands, history=list(history), pareto=pareto)


def top_candidates(cands: list[S.Candidate], n: int = 5, min_gap: float = 0.15) -> list[S.Candidate]:
    out: list[S.Candidate] = []
    for c in sorted([c for c in cands if c.feasible], key=lambda c: c.objectives[0]):
        if any(all(abs(a - b) < min_gap for a, b in zip(o.x, c.x)) for o in out):
            continue
        out.append(c)
        if len(out) >= n:
            break
    return out


def run(cfg: S.OptimizationConfig, evaluate: Callable[[S.Design], dict], on_progress: Callable[[S.GenerationUpdate], None],
        should_stop: Callable[[], bool]) -> S.OptimizationResult:
    if not any(v.enabled for v in cfg.variables):
        raise ValueError("enable at least one design variable")
    multi = cfg.objective == "pareto_ld_cl"
    problem = AirfoilProblem(cfg, evaluate, should_stop)
    common = dict(pop_size=cfg.population_size, sampling=LHS(), crossover=SBX(prob=0.9, eta=15),
                  mutation=PM(eta=20), eliminate_duplicates=True)
    algorithm = NSGA2(**common) if (multi or cfg.algorithm == "nsga2") else GA(**common)
    t0 = time.time()
    history: list[S.HistoryPoint] = []
    last: dict = {}

    class Progress(Callback):
        def notify(self, algorithm):
            if should_stop():
                raise Cancelled()
            upd = _snapshot(problem, algorithm.pop, algorithm.n_gen - 1, t0, history, multi)
            last["u"] = upd
            on_progress(upd)

    minimize(problem, algorithm, ("n_gen", cfg.generations + 1), seed=cfg.seed, callback=Progress(), verbose=False)
    final: S.GenerationUpdate = last["u"]
    return S.OptimizationResult(**final.model_dump(), top=top_candidates(list(problem.records.values())), config=cfg)
