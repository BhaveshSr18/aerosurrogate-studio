"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Clock, Cpu, Play, PencilRuler, Square, Target, Trophy, Workflow } from "lucide-react";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Segmented, Switch } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { NumberInput, Slider, SliderField } from "@/components/ui/slider-field";
import { InfoTip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { XYChart } from "@/components/viz/xy-chart";
import { AirfoilShape } from "@/components/viz/airfoil-shape";
import { useApp, useHydrated } from "@/lib/store";
import { useEnvelope } from "@/lib/hooks";
import { api } from "@/lib/api/client";
import { OBJECTIVE_META } from "@/lib/optimizer/engine";
import { designation } from "@/lib/physics/naca";
import { cn } from "@/lib/utils";
import type { Candidate, Design, Envelope, GenerationUpdate, NacaFamily, ObjectiveKind, OptimizationConfig, Prediction, VariableSpec } from "@/lib/types";

/** Target GPU inference time per full-mesh evaluation — PLACEHOLDER until Phase 0 benchmarks. */
const EST_SECONDS_PER_EVAL_GPU = 0.25;

function defaultVariables(family: NacaFamily, d: Design, env: Envelope): VariableSpec[] {
  const aoa: VariableSpec = { key: "aoa", label: "Angle of attack", unit: "°", enabled: true, min: 0, max: 10, fixed: d.aoa };
  if (family === "4")
    return [
      { key: "M", label: "Max camber M", unit: "%c", enabled: true, min: env.naca4.M.min, max: env.naca4.M.max, fixed: d.naca4.M },
      { key: "P", label: "Camber position P", unit: "/10", enabled: true, min: 1, max: env.naca4.P.max, fixed: d.naca4.P },
      { key: "T", label: "Thickness T", unit: "%c", enabled: true, min: 8, max: 18, fixed: d.naca4.T },
      aoa,
    ];
  return [
    { key: "L", label: "Design lift L", unit: "", enabled: true, min: env.naca5.L.min, max: env.naca5.L.max, fixed: d.naca5.L },
    { key: "P", label: "Camber position P", unit: "/20", enabled: true, min: env.naca5.P.min, max: env.naca5.P.max, fixed: d.naca5.P },
    { key: "T", label: "Thickness T", unit: "%c", enabled: true, min: 8, max: 18, fixed: d.naca5.T },
    aoa,
  ];
}

function envRange(key: string, family: NacaFamily, env: Envelope, extrapolate = false) {
  const r = key === "aoa" ? env.aoa : family === "4" ? env.naca4[key as "M" | "P" | "T"] : env.naca5[key as "L" | "P" | "T"];
  if (!extrapolate) return r;
  // Allow a 25% extrapolation margin; geometric parameters stay physical.
  const pad = 0.25 * (r.max - r.min);
  return { ...r, min: key === "aoa" ? r.min - pad : Math.max(key === "T" ? 3 : 0, r.min - pad), max: r.max + pad };
}

function displayObjective(kind: ObjectiveKind, v: number) {
  return kind === "min_cd_at_cl" ? `${(v * 1e4).toFixed(1)} cts` : (-v).toFixed(2);
}

export function OptimizeView() {
  const router = useRouter();
  const design = useApp((s) => s.design);
  const setDesign = useApp((s) => s.setDesign);
  const saveDesign = useApp((s) => s.saveDesign);
  const last = useApp((s) => s.lastOptimization);
  const setLast = useApp((s) => s.setLastOptimization);
  const hydrated = useHydrated();
  const env = useEnvelope();

  const [cfg, setCfg] = useState<OptimizationConfig>(() => ({
    family: design.family,
    objective: "max_ld",
    targetCl: 0.6,
    robustBand: 2,
    uncertaintyPenalty: 0,
    variables: defaultVariables(design.family, design, env),
    speed: design.speed,
    reflex: design.naca5.Q,
    constraints: { minThickness: 10, maxAbsCm: null, stayInEnvelope: true },
    algorithm: "ga",
    populationSize: 40,
    generations: 30,
    seed: 7,
  }));
  // Re-seed from the persisted design once it's restored.
  useEffect(() => {
    if (!hydrated) return;
    const d = useApp.getState().design;
    setCfg((c) => ({ ...c, family: d.family, speed: d.speed, reflex: d.naca5.Q, variables: defaultVariables(d.family, d, env) }));
  }, [hydrated, env]);

  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  // The configuration of the run on screen: labels and progress must not follow edits made to
  // the form after the run started.
  const [runCfg, setRunCfg] = useState<OptimizationConfig | null>(null);
  const [live, setLive] = useState<GenerationUpdate | null>(null);
  const [baseline, setBaseline] = useState<Prediction | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const view: GenerationUpdate | null = live ?? last;
  const shown = (running ? runCfg : last?.config ?? runCfg) ?? cfg;
  const multi = cfg.objective === "pareto_ld_cl";
  const enabled = cfg.variables.filter((v) => v.enabled).length;
  const evals = cfg.populationSize * (cfg.generations + 1) * (cfg.objective === "robust_ld" ? 3 : 1);

  const setVar = (key: string, patch: Partial<VariableSpec>) => setCfg((c) => ({ ...c, variables: c.variables.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));

  const run = async () => {
    if (!enabled) return toast("Nothing to optimize", "Enable at least one design variable.", "warning");
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(true);
    setStopped(false);
    setLive(null);
    setLast(null);
    const started = { ...cfg, algorithm: multi ? "nsga2" : cfg.algorithm } as OptimizationConfig;
    setRunCfg(started);
    api.predict({ ...design, speed: cfg.speed }).then(setBaseline);
    try {
      const result = await api.optimize(started, setLive, ctrl.signal);
      setLast(result);
      setLive(null);
      toast("Optimization complete", `${result.evaluations.toLocaleString("en-US")} surrogate evaluations in ${(result.elapsedMs / 1000).toFixed(1)} s`, "success");
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast("Optimization failed", String((e as Error)?.message ?? e), "warning");
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    ctrlRef.current?.abort();
    setRunning(false);
    setStopped(true);
    toast("Run cancelled");
  };

  const best = view?.best ?? null;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Optimizer</h1>
          <p className="mt-1 text-sm text-muted">
            Evolutionary search over NACA parameters, with each candidate scored by the surrogate instead of a CFD run.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* ---------- Configuration ---------- */}
        <Card className="h-fit">
          <CardBody className="space-y-6 pt-4">
            <section>
              <SectionLabel className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" /> Objective
              </SectionLabel>
              <Select
                label="Objective"
                value={cfg.objective}
                onValueChange={(v) => setCfg((c) => ({ ...c, objective: v as ObjectiveKind, algorithm: v === "pareto_ld_cl" ? "nsga2" : "ga" }))}
                options={(Object.keys(OBJECTIVE_META) as ObjectiveKind[]).map((k) => ({ value: k, label: OBJECTIVE_META[k].label, hint: OBJECTIVE_META[k].description }))}
              />
              <div className="mt-4 space-y-4">
                {cfg.objective === "min_cd_at_cl" && (
                  <SliderField label="Target Cl" value={cfg.targetCl} onChange={(v) => setCfg((c) => ({ ...c, targetCl: v }))} min={0.1} max={1.4} step={0.05} digits={2} />
                )}
                {cfg.objective === "robust_ld" && (
                  <SliderField label="AoA band ±" unit="°" value={cfg.robustBand} onChange={(v) => setCfg((c) => ({ ...c, robustBand: v }))} min={0.5} max={4} step={0.5} />
                )}
                {!multi && (
                  <SliderField
                    label="Uncertainty penalty k"
                    hint="Scores designs by mean − k·σ from the ensemble, steering the search away from designs the model is unsure about."
                    value={cfg.uncertaintyPenalty}
                    onChange={(v) => setCfg((c) => ({ ...c, uncertaintyPenalty: v }))}
                    min={0}
                    max={2}
                    step={0.1}
                  />
                )}
              </div>
            </section>

            <section>
              <SectionLabel className="flex items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5" /> Design space
              </SectionLabel>
              <Segmented
                label="NACA family"
                className="mb-3 flex w-full"
                value={cfg.family}
                onChange={(f) => setCfg((c) => ({ ...c, family: f, variables: defaultVariables(f, design, env) }))}
                options={[
                  { value: "4", label: "4-digit" },
                  { value: "5", label: "5-digit" },
                ]}
              />
              <div className="space-y-2.5">
                {cfg.variables.map((v) => {
                  const r = envRange(v.key, cfg.family, env, !cfg.constraints.stayInEnvelope);
                  return (
                    <div key={v.key} className={cn("rounded-lg border border-border p-3", v.enabled ? "bg-surface" : "bg-surface-2")}>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-medium text-fg-2">
                          <Switch checked={v.enabled} onCheckedChange={(e) => setVar(v.key, { enabled: e })} label={`Optimize ${v.label}`} />
                          {v.label}
                        </label>
                        {v.enabled ? (
                          <span className="tabular font-mono text-[11px] text-fg">
                            {v.min.toFixed(1)} – {v.max.toFixed(1)} {v.unit}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted">
                            fixed
                            <NumberInput label={`${v.label} fixed value`} value={v.fixed} onChange={(x) => setVar(v.key, { fixed: x })} min={r.min} max={r.max} step={r.step} />
                          </div>
                        )}
                      </div>
                      {v.enabled && (
                        <Slider
                          className="mt-2.5"
                          label={`${v.label} bounds`}
                          range
                          value={[v.min, v.max]}
                          onValueChange={([a, b]) => setVar(v.key, { min: a, max: b })}
                          min={r.min}
                          max={r.max}
                          step={r.step}
                        />
                      )}
                    </div>
                  );
                })}
                {cfg.family === "5" && (
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-xs text-fg-2">
                    Reflexed camber (Q = 1)
                    <Switch checked={cfg.reflex === 1} onCheckedChange={(e) => setCfg((c) => ({ ...c, reflex: e ? 1 : 0 }))} label="Reflexed camber" />
                  </div>
                )}
              </div>
              <div className="mt-4">
                <SliderField label="Inflow speed U∞" unit="m/s" value={cfg.speed} onChange={(v) => setCfg((c) => ({ ...c, speed: v }))} {...env.speed} />
              </div>
            </section>

            <section>
              <SectionLabel>Constraints</SectionLabel>
              <div className="space-y-4">
                <SliderField
                  label="Minimum thickness"
                  hint="Structural requirement: the maximum thickness must be at least this much."
                  unit="%c"
                  value={cfg.constraints.minThickness}
                  onChange={(v) => setCfg((c) => ({ ...c, constraints: { ...c.constraints, minThickness: v } }))}
                  min={5}
                  max={18}
                  step={0.5}
                />
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-xs font-medium text-fg-2">
                    <span className="flex items-center gap-1.5">
                      Limit |Cm¼|
                      <InfoTip>Limits the pitching moment, which drives tail sizing and trim drag.</InfoTip>
                    </span>
                    <Switch
                      checked={cfg.constraints.maxAbsCm != null}
                      onCheckedChange={(e) => setCfg((c) => ({ ...c, constraints: { ...c.constraints, maxAbsCm: e ? 0.08 : null } }))}
                      label="Limit pitching moment"
                    />
                  </div>
                  {cfg.constraints.maxAbsCm != null && (
                    <div className="mt-3">
                      <SliderField
                        label="Max |Cm¼|"
                        value={cfg.constraints.maxAbsCm}
                        onChange={(v) => setCfg((c) => ({ ...c, constraints: { ...c.constraints, maxAbsCm: v } }))}
                        min={0.01}
                        max={0.2}
                        step={0.005}
                        digits={3}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-fg-2">
                  <span className="flex items-center gap-1.5">
                    Stay inside training envelope
                    <InfoTip>
                      Clips the bounds to the surrogate&apos;s training ranges so the optimizer cannot exploit extrapolation errors. Turning it off allows a
                      25% margin beyond the training data.
                    </InfoTip>
                  </span>
                  <Switch
                    checked={cfg.constraints.stayInEnvelope}
                    onCheckedChange={(e) =>
                      setCfg((c) => ({
                        ...c,
                        constraints: { ...c.constraints, stayInEnvelope: e },
                        variables: e
                          ? c.variables.map((v) => {
                              const r = envRange(v.key, c.family, env);
                              return { ...v, min: Math.max(r.min, Math.min(v.min, r.max)), max: Math.min(r.max, Math.max(v.max, r.min)) };
                            })
                          : c.variables,
                      }))
                    }
                    label="Stay inside training envelope"
                  />
                </div>
              </div>
            </section>

            <section>
              <SectionLabel className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" /> Algorithm &amp; budget
              </SectionLabel>
              <Segmented
                label="Algorithm"
                className="mb-4 flex w-full"
                value={multi ? "nsga2" : cfg.algorithm}
                onChange={(a) => !multi && setCfg((c) => ({ ...c, algorithm: a }))}
                options={[
                  { value: "ga", label: "Genetic algorithm" },
                  { value: "nsga2", label: "NSGA-II" },
                ]}
              />
              <div className="space-y-4">
                <SliderField label="Population" value={cfg.populationSize} onChange={(v) => setCfg((c) => ({ ...c, populationSize: Math.round(v) }))} min={12} max={100} step={2} digits={0} />
                <SliderField label="Generations" value={cfg.generations} onChange={(v) => setCfg((c) => ({ ...c, generations: Math.round(v) }))} min={5} max={80} step={1} digits={0} />
                <SliderField label="Random seed" value={cfg.seed} onChange={(v) => setCfg((c) => ({ ...c, seed: Math.round(v) }))} min={0} max={999} step={1} digits={0} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 text-[11px]">
                <div>
                  <div className="text-muted">Surrogate evaluations</div>
                  <div className="tabular font-mono text-sm text-fg">{evals.toLocaleString("en-US")}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted">
                    Est. on GPU
                    <InfoTip>Placeholder estimate at {EST_SECONDS_PER_EVAL_GPU}s per full-mesh inference, to be replaced by the Phase 0 benchmark.</InfoTip>
                  </div>
                  <div className="tabular font-mono text-sm text-fg">≈ {Math.ceil((evals * EST_SECONDS_PER_EVAL_GPU) / 60)} min</div>
                </div>
              </div>
            </section>

            {running ? (
              <Button variant="danger" size="lg" className="w-full" onClick={stop}>
                <Square className="h-4 w-4" /> Stop run
              </Button>
            ) : (
              <Button size="lg" className="w-full" onClick={run}>
                <Play className="h-4 w-4" /> Run optimization
              </Button>
            )}
          </CardBody>
        </Card>

        {/* ---------- Results ---------- */}
        <div className="min-w-0 space-y-5">
          {!view ? (
            <EmptyState />
          ) : (
            <>
              <RunHeader view={view} total={shown.generations} running={running} stopped={stopped && !last} kind={shown.objective} />
              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader title="Convergence" description={`${OBJECTIVE_META[shown.objective].short} per generation`} />
                  <CardBody>
                    <XYChart
                      height={250}
                      xLabel="Generation"
                      yLabel={OBJECTIVE_META[shown.objective].short}
                      xFormat={(v) => v.toFixed(0)}
                      yFormat={(v) => (shown.objective === "min_cd_at_cl" ? (v * 1e4).toFixed(0) : v.toFixed(1))}
                      series={[
                        { id: "best", name: "Best", color: "var(--series-1)", points: view.history.map((h) => [h.generation, toPlot(shown.objective, h.best)]) },
                        { id: "mean", name: "Population mean", color: "var(--series-2)", dashed: true, points: view.history.map((h) => [h.generation, toPlot(shown.objective, h.mean)]) },
                      ]}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader
                    title={view.pareto ? "Pareto front" : "Population"}
                    description={view.pareto ? "L/D vs Cl · non-dominated designs highlighted" : "Current generation in the Cl – Cd plane"}
                  />
                  <CardBody>
                    <PopulationChart view={view} />
                  </CardBody>
                </Card>
              </div>
              {best && (
                <BestDesign
                  best={best}
                  baseline={baseline}
                  baselineDesign={design}
                  onOpen={(d) => {
                    setDesign(d);
                    router.push("/studio");
                  }}
                  onSave={(d) => {
                    const r = saveDesign(d, `Optimized ${designation(d).replace("≈ ", "")}`);
                    toast(r.ok ? "Saved to Compare" : "Compare is full", r.reason, r.ok ? "success" : "warning");
                  }}
                />
              )}
              {last && (
                <TopTable
                  items={last.pareto?.length ? spread(last.pareto, 8) : last.top}
                  pareto={!!last.pareto}
                  onLoad={(d) => {
                    setDesign(d);
                    router.push("/studio");
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Up to n items evenly spaced along a sorted list (the Pareto front, low Cl to high Cl). */
function spread<T>(items: T[], n: number) {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

function toPlot(kind: ObjectiveKind, v: number) {
  return kind === "min_cd_at_cl" ? v : -v;
}

function RunHeader({
  view,
  total,
  running,
  stopped,
  kind,
}: {
  view: GenerationUpdate;
  total: number;
  running: boolean;
  stopped: boolean;
  kind: ObjectiveKind;
}) {
  const pct = Math.min(100, (view.generation / total) * 100);
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] text-muted">Status</div>
            {running ? (
              <Badge tone="accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Running
              </Badge>
            ) : stopped ? (
              <Badge tone="warning">Stopped early</Badge>
            ) : (
              <Badge tone="good">Complete</Badge>
            )}
          </div>
          <Metric label="Generation" value={`${view.generation} / ${total}`} />
          <Metric label="Evaluations" value={view.evaluations.toLocaleString("en-US")} />
          <Metric label="Elapsed" value={`${(view.elapsedMs / 1000).toFixed(1)} s`} icon={<Clock className="h-3 w-3" />} />
          <Metric label={`Best ${OBJECTIVE_META[kind].short}`} value={displayObjective(kind, view.best.objectives[0])} strong />
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value, icon, strong }: { label: string; value: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </div>
      <div className={cn("tabular font-mono", strong ? "text-lg font-semibold text-fg" : "text-sm text-fg")}>{value}</div>
    </div>
  );
}

function PopulationChart({ view }: { view: GenerationUpdate }) {
  if (view.pareto) {
    const front = view.pareto;
    // Compare by design vector: the final front is re-scored, so object identity differs.
    const onFront = new Set(front.map((c) => JSON.stringify(c.x)));
    return (
      <XYChart
        height={250}
        xLabel="Cl"
        yLabel="L/D"
        yFormat={(v) => v.toFixed(0)}
        xFormat={(v) => v.toFixed(2)}
        series={[
          {
            id: "pop",
            name: "Population",
            color: "var(--axis)",
            kind: "scatter",
            size: 3.5,
            points: view.population.filter((c) => !onFront.has(JSON.stringify(c.x))).map((c) => [c.cl, c.ld]),
          },
          { id: "front", name: "Pareto front", color: "var(--series-1)", markers: true, points: front.map((c) => [c.cl, c.ld]) },
        ]}
      />
    );
  }
  const feas = view.population.filter((c) => c.feasible);
  const infeas = view.population.filter((c) => !c.feasible);
  return (
    <XYChart
      height={250}
      xLabel="Cd (counts)"
      yLabel="Cl"
      xFormat={(v) => v.toFixed(0)}
      yFormat={(v) => v.toFixed(2)}
      series={[
        { id: "inf", name: "Infeasible", color: "var(--axis)", kind: "scatter", size: 3.5, points: infeas.map((c) => [c.cd * 1e4, c.cl]) },
        { id: "feas", name: "Feasible", color: "var(--series-1)", kind: "scatter", points: feas.map((c) => [c.cd * 1e4, c.cl]) },
        { id: "best", name: "Best", color: "var(--series-2)", kind: "scatter", size: 6, points: [[view.best.cd * 1e4, view.best.cl]] },
      ]}
    />
  );
}

function BestDesign({
  best,
  baseline,
  baselineDesign,
  onOpen,
  onSave,
}: {
  best: Candidate;
  baseline: Prediction | null;
  baselineDesign: Design;
  onOpen: (d: Design) => void;
  onSave: (d: Design) => void;
}) {
  const rows: { label: string; b?: number; o: number; fmt: (v: number) => string; upGood: boolean | null }[] = [
    { label: "Cl", b: baseline?.cl, o: best.cl, fmt: (v) => v.toFixed(3), upGood: true },
    { label: "Cd (counts)", b: baseline ? baseline.cd * 1e4 : undefined, o: best.cd * 1e4, fmt: (v) => v.toFixed(0), upGood: false },
    { label: "L/D", b: baseline?.ld, o: best.ld, fmt: (v) => v.toFixed(1), upGood: true },
    { label: "Cm¼", b: baseline?.cm, o: best.cm, fmt: (v) => v.toFixed(3), upGood: null },
  ];
  const d = best.design;
  const params =
    d.family === "4"
      ? [["M", d.naca4.M], ["P", d.naca4.P], ["T", d.naca4.T]]
      : [["L", d.naca5.L], ["P", d.naca5.P], ["Q", d.naca5.Q], ["T", d.naca5.T]];
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-accent" /> Best design · {designation(d)}
          </span>
        }
        description={
          best.feasible
            ? "Compared with the current Studio design as the baseline"
            : "No candidate met every constraint: this is the least-violating design. Relax the constraints or widen the bounds."
        }
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onSave(d)}>
              <BookmarkPlus className="h-3.5 w-3.5" /> Save
            </Button>
            <Button size="sm" onClick={() => onOpen(d)}>
              <PencilRuler className="h-3.5 w-3.5" /> Open in Studio
            </Button>
          </>
        }
      />
      <CardBody className="grid gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 flex gap-4 text-[11px] text-fg-2">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-series-1" /> Optimized
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden="true">
                <line x1="0" x2="14" y1="2" y2="2" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              Baseline
            </span>
          </div>
          <AirfoilShape
            items={[
              { design: d, color: "var(--series-1)" },
              { design: baselineDesign, color: "var(--muted)", dashed: true },
            ]}
            height={170}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {params.map(([k, v]) => (
              <span key={k as string} className="tabular rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px]">
                {k} = {(v as number).toFixed(2)}
              </span>
            ))}
            <span className="tabular rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px]">α = {d.aoa.toFixed(2)}°</span>
          </div>
        </div>
        <table className="tabular h-fit w-full text-xs">
          <thead className="text-[11px] text-muted">
            <tr>
              <th className="pb-2 text-left font-medium" />
              <th className="pb-2 text-right font-medium">Baseline</th>
              <th className="pb-2 text-right font-medium">Optimized</th>
              <th className="pb-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => {
              const delta = r.b != null ? r.o - r.b : null;
              const good = delta != null && r.upGood != null && (delta > 0) === r.upGood;
              return (
                <tr key={r.label} className="border-t border-border">
                  <td className="py-2 font-sans text-fg-2">{r.label}</td>
                  <td className="py-2 text-right text-muted">{r.b != null ? r.fmt(r.b) : "…"}</td>
                  <td className="py-2 text-right font-semibold text-fg">{r.fmt(r.o)}</td>
                  <td
                    className={cn(
                      "py-2 text-right",
                      delta == null || Math.abs(delta) < 1e-9 || r.upGood == null ? "text-muted" : good ? "text-good-text" : "text-critical",
                    )}
                  >
                    {delta != null ? `${delta > 0 ? "+" : "−"}${r.fmt(Math.abs(delta))}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function TopTable({ items, pareto, onLoad }: { items: Candidate[]; pareto: boolean; onLoad: (d: Design) => void }) {
  return (
    <Card>
      <CardHeader title={pareto ? "Pareto-optimal designs" : "Top candidates"} description="Distinct feasible designs, best first" />
      <CardBody>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="tabular w-full text-right font-mono text-xs">
            <thead className="bg-surface-2 text-[11px] text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-sans font-medium">#</th>
                <th className="px-3 py-2 text-left font-sans font-medium">Designation</th>
                <th className="px-3 py-2 font-sans font-medium">α (°)</th>
                <th className="px-3 py-2 font-sans font-medium">Cl</th>
                <th className="px-3 py-2 font-sans font-medium">Cd (cts)</th>
                <th className="px-3 py-2 font-sans font-medium">L/D</th>
                <th className="px-3 py-2 font-sans font-medium">Cm¼</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 text-left text-muted">{i + 1}</td>
                  <td className="px-3 py-2 text-left text-fg">{designation(c.design)}</td>
                  <td className="px-3 py-2">{c.design.aoa.toFixed(2)}</td>
                  <td className="px-3 py-2">{c.cl.toFixed(3)}</td>
                  <td className="px-3 py-2">{(c.cd * 1e4).toFixed(0)}</td>
                  <td className="px-3 py-2 text-fg">{c.ld.toFixed(1)}</td>
                  <td className="px-3 py-2">{c.cm.toFixed(3)}</td>
                  <td className="px-3 py-2">
                    <button className="font-sans text-accent hover:underline" onClick={() => onLoad(c.design)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyState() {
  const steps = [
    { t: "Pick an objective", d: "Efficiency, low drag at a lift target, maximum lift, robustness across AoA, or a Pareto trade-off." },
    { t: "Bound the design space", d: "Choose which NACA parameters are free. Bounds are clipped to the surrogate's training envelope." },
    { t: "Add constraints", d: "Minimum thickness for structure, a pitching-moment limit for trim." },
    { t: "Run", d: "Each candidate is meshed by morphing and evaluated by the MeshGraphNet surrogate, streamed live." },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="relative border-b border-border bg-surface-2 px-6 py-10">
        <div className="bg-blueprint absolute inset-0 opacity-60" />
        <div className="relative max-w-xl">
          <Badge tone="accent">Surrogate-in-the-loop optimization</Badge>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Thousands of CFD-quality evaluations in minutes</h2>
          <p className="mt-2 text-sm text-fg-2">
            A single RANS simulation of an airfoil takes minutes to hours. The surrogate predicts the full flow field in a fraction of a second,
            which makes population-based optimization practical.
          </p>
        </div>
      </div>
      <CardBody className="grid gap-4 pt-5 sm:grid-cols-2">
        {steps.map((s, i) => (
          <div key={s.t} className="flex gap-3">
            <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{s.t}</div>
              <div className="mt-0.5 text-xs text-muted">{s.d}</div>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
