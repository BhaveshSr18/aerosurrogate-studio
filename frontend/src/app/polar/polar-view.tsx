"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, PencilRuler, Table2 } from "lucide-react";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { Button, buttonClass } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { Slider, SliderField } from "@/components/ui/slider-field";
import { XYChart, type XYSeries } from "@/components/viz/xy-chart";
import { AirfoilShape } from "@/components/viz/airfoil-shape";
import { useApp, useHydrated } from "@/lib/store";
import { useDebounced, useEnvelope } from "@/lib/hooks";
import { api } from "@/lib/api/client";
import { designation } from "@/lib/physics/naca";
import { fmtRe } from "@/lib/format";
import { reynolds } from "@/lib/physics/envelope";
import { downloadText } from "@/lib/utils";
import type { Design, PolarPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

const SLOT = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

interface Entry {
  id: string;
  name: string;
  design: Design;
  color: string;
}

function summarize(points: PolarPoint[]) {
  if (!points.length) return null;
  const clMax = points.reduce((a, b) => (b.cl > a.cl ? b : a));
  const ldMax = points.reduce((a, b) => (b.ld > a.ld ? b : a));
  const cdMin = points.reduce((a, b) => (b.cd < a.cd ? b : a));
  let alpha0: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.cl <= 0 && b.cl > 0) alpha0 = a.aoa + ((0 - a.cl) * (b.aoa - a.aoa)) / (b.cl - a.cl);
  }
  // A peak at the last angle only means the sweep stopped before the lift curve turned over.
  const clMaxAtEnd = clMax === points[points.length - 1] && !clMax.stalled;
  return { clMax, clMaxAtEnd, ldMax, cdMin, alpha0 };
}

export function PolarView() {
  const design = useApp((s) => s.design);
  const setDesign = useApp((s) => s.setDesign);
  const saved = useApp((s) => s.saved);
  useHydrated();
  const env = useEnvelope();
  const [range, setRange] = useState<[number, number]>([-4, 15]);
  const [step, setStep] = useState("1");
  const [speed, setSpeed] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [view, setView] = useState<"charts" | "table">("charts");
  const [data, setData] = useState<Record<string, PolarPoint[]>>({});
  const [loading, setLoading] = useState(false);

  const u = speed ?? design.speed;
  const entries: Entry[] = useMemo(
    () => [
      { id: "current", name: `${designation(design)} (current)`, design: { ...design, speed: u }, color: SLOT[0] },
      ...saved
        .filter((s) => overlay.includes(s.id))
        .slice(0, 3)
        .map((s, i) => ({ id: s.id, name: s.name, design: { ...s.design, speed: u }, color: SLOT[i + 1] })),
    ],
    [design, saved, overlay, u],
  );

  const reqObj = useMemo(() => ({ entries, range, step }), [entries, range, step]);
  const req = useDebounced(reqObj, 250);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    Promise.all(
      req.entries.map((e) =>
        api.sweep({ design: e.design, aoaStart: req.range[0], aoaEnd: req.range[1], aoaStep: Number(req.step) }, ctrl.signal).then((pts) => [e.id, pts] as const),
      ),
    )
      .then((res) => {
        setData(Object.fromEntries(res));
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setLoading(false);
      });
    return () => ctrl.abort();
  }, [req]);

  const cur = data.current ?? [];
  const stats = summarize(cur);
  const multi = entries.length > 1;
  const mk = (fn: (p: PolarPoint) => [number, number], band?: (p: PolarPoint) => [number, number, number]): XYSeries[] =>
    entries.map((e) => ({
      id: e.id,
      name: e.name,
      color: e.color,
      points: (data[e.id] ?? []).map(fn),
      markers: !multi,
      band: band && !multi && e.id === "current" ? (data[e.id] ?? []).map(band) : undefined,
    }));

  const exportCsv = () => {
    const rows = ["design,aoa_deg,cl,cd,cm,l_over_d,cl_sigma,cd_sigma"];
    for (const e of entries) for (const p of data[e.id] ?? []) rows.push([`"${e.name}"`, p.aoa, p.cl, p.cd, p.cm, p.ld, p.clSigma, p.cdSigma].map((v) => (typeof v === "number" ? v.toFixed(5) : v)).join(","));
    downloadText("polars.csv", rows.join("\n"), "text/csv");
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Polar analysis</h1>
          <p className="mt-1 text-sm text-muted">Angle-of-attack sweeps from batched surrogate inference: lift curve, drag polar, efficiency and pitching moment.</p>
        </div>
        <div className="flex gap-2">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "charts", label: "Charts" },
              { value: "table", label: <span className="flex items-center gap-1"><Table2 className="h-3.5 w-3.5" /> Table</span> },
            ]}
          />
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardBody className="space-y-6 pt-4">
            <div>
              <SectionLabel>Design</SectionLabel>
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">{designation(design)}</span>
                  <Link href="/studio" className={buttonClass("ghost", "sm", "h-7 px-2")}>
                    <PencilRuler className="h-3.5 w-3.5" /> Edit
                  </Link>
                </div>
                <AirfoilShape items={[{ design }]} annotate={false} showCamber={false} height={70} className="mt-2" />
              </div>
            </div>
            <div>
              <SectionLabel>Sweep</SectionLabel>
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex justify-between text-xs font-medium text-fg-2">
                    <span>AoA range</span>
                    <span className="tabular font-mono text-fg">
                      {range[0].toFixed(0)}° → {range[1].toFixed(0)}°
                    </span>
                  </div>
                  <Slider
                    label="AoA range"
                    range
                    value={range}
                    onValueChange={(v) => setRange([v[0], v[1]] as [number, number])}
                    min={env.aoa.min}
                    max={env.aoa.max + 5}
                    step={1}
                    minStepsBetweenThumbs={2}
                  />
                  {range[1] > env.aoa.max && <p className="mt-1.5 text-[11px] text-warning-text">Angles above {env.aoa.max}° extrapolate beyond the training data.</p>}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-fg-2">Step</span>
                  <Segmented label="AoA step" size="sm" value={step} onChange={setStep} options={["0.5", "1", "2"].map((s) => ({ value: s, label: `${s}°` }))} />
                </div>
                <SliderField label="Inflow speed U∞" unit="m/s" value={u} onChange={setSpeed} {...env.speed} />
                <div className="tabular font-mono text-[11px] text-muted">Re = {fmtRe(reynolds(u))}</div>
              </div>
            </div>
            <div>
              <SectionLabel>Overlay saved designs</SectionLabel>
              {saved.length === 0 ? (
                <p className="text-xs text-muted">
                  Save designs from the{" "}
                  <Link href="/studio" className="text-accent hover:underline">
                    Studio
                  </Link>{" "}
                  to compare their polars here.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {saved.map((s) => {
                    const on = overlay.includes(s.id);
                    const idx = entries.findIndex((e) => e.id === s.id);
                    const disabled = !on && overlay.length >= 3;
                    return (
                      <li key={s.id}>
                        <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-xs", on && "bg-surface-2", disabled && "cursor-not-allowed opacity-50")}>
                          <input
                            type="checkbox"
                            className="accent-[var(--accent)]"
                            checked={on}
                            disabled={disabled}
                            onChange={() => setOverlay((o) => (on ? o.filter((x) => x !== s.id) : [...o, s.id]))}
                          />
                          <span className="h-0.5 w-3 rounded" style={{ background: on && idx >= 0 ? entries[idx].color : "var(--axis)" }} />
                          <span className="flex-1 truncate text-fg-2">{s.name}</span>
                          <button
                            type="button"
                            className="text-[10px] text-accent hover:underline"
                            onClick={(ev) => {
                              ev.preventDefault();
                              setDesign(s.design);
                            }}
                          >
                            Load
                          </button>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label={stats?.clMaxAtEnd ? "Cl max (≥)" : "Cl max"}
              value={stats ? stats.clMax.cl.toFixed(2) : null}
              sub={stats ? (stats.clMaxAtEnd ? `still rising at α = ${stats.clMax.aoa.toFixed(1)}°` : `at α = ${stats.clMax.aoa.toFixed(1)}°`) : ""}
            />
            <Stat label="(L/D) max" value={stats ? stats.ldMax.ld.toFixed(1) : null} sub={stats ? `at α = ${stats.ldMax.aoa.toFixed(1)}°` : ""} accent />
            <Stat label="Cd min" value={stats ? `${Math.round(stats.cdMin.cd * 1e4)}` : null} sub={stats ? `counts at α = ${stats.cdMin.aoa.toFixed(1)}°` : ""} />
            <Stat label="Zero-lift α₀" value={stats ? (stats.alpha0 != null ? `${stats.alpha0.toFixed(2)}°` : "n/a") : null} sub="Cl = 0 crossing" />
          </div>

          {view === "charts" ? (
            <div className={cn("grid gap-5 xl:grid-cols-2", loading && "opacity-70 transition-opacity")}>
              <ChartCard title="Lift curve" description="Cl vs α · shaded band = ±1σ">
                <XYChart xLabel="α (°)" yLabel="Cl" series={mk((p) => [p.aoa, p.cl], (p) => [p.aoa, p.cl - p.clSigma, p.cl + p.clSigma])} yFormat={(v) => v.toFixed(1)} />
              </ChartCard>
              <ChartCard title="Drag polar" description="Cl vs Cd (counts)">
                <XYChart xLabel="Cd (counts)" yLabel="Cl" series={mk((p) => [p.cd * 1e4, p.cl])} xFormat={(v) => v.toFixed(0)} yFormat={(v) => v.toFixed(1)} />
              </ChartCard>
              <ChartCard title="Efficiency" description="L/D vs α">
                <XYChart xLabel="α (°)" yLabel="L/D" series={mk((p) => [p.aoa, p.ld])} yFormat={(v) => v.toFixed(0)} />
              </ChartCard>
              <ChartCard title="Pitching moment" description="Cm about quarter chord vs α">
                <XYChart xLabel="α (°)" yLabel="Cm¼" series={mk((p) => [p.aoa, p.cm])} yFormat={(v) => v.toFixed(2)} />
              </ChartCard>
            </div>
          ) : (
            <Card>
              <CardHeader title="Polar data" description={entries.map((e) => e.name).join(" · ")} />
              <CardBody>
                <div className="max-h-[640px] overflow-auto rounded-lg border border-border">
                  <table className="tabular w-full text-right font-mono text-xs">
                    <thead className="sticky top-0 bg-surface-2 text-[11px] text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-sans font-medium">Design</th>
                        {["α (°)", "Cl", "±σ", "Cd (cts)", "Cm¼", "L/D"].map((h) => (
                          <th key={h} className="px-3 py-2 font-sans font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.flatMap((e) =>
                        (data[e.id] ?? []).map((p) => (
                          <tr key={`${e.id}${p.aoa}`} className={cn("border-t border-border", p.stalled && "text-critical")}>
                            <td className="px-3 py-1.5 text-left font-sans text-fg-2">
                              <span className="mr-2 inline-block h-0.5 w-2.5 rounded align-middle" style={{ background: e.color }} />
                              {e.name}
                            </td>
                            <td className="px-3 py-1.5">{p.aoa.toFixed(1)}</td>
                            <td className="px-3 py-1.5 text-fg">{p.cl.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-muted">{p.clSigma.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-fg">{(p.cd * 1e4).toFixed(0)}</td>
                            <td className="px-3 py-1.5">{p.cm.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-fg">{p.ld.toFixed(1)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted">Rows in red are flagged as likely separated (post-stall).</p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string | null; sub: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border p-4 shadow-card", accent ? "bg-accent-soft" : "bg-surface")}>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      {value == null ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>}
      <div className="tabular mt-0.5 font-mono text-[11px] text-muted">{sub}</div>
    </div>
  );
}
