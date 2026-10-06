"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitCompareArrows, PencilRuler, Star, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { AirfoilShape, SERIES } from "@/components/viz/airfoil-shape";
import { XYChart } from "@/components/viz/xy-chart";
import { MAX_COMPARE, useApp, useHydrated } from "@/lib/store";
import { api } from "@/lib/api/client";
import { designation } from "@/lib/physics/naca";
import { cn } from "@/lib/utils";
import type { Prediction } from "@/lib/types";

export function CompareView() {
  const router = useRouter();
  const saved = useApp((s) => s.saved);
  const remove = useApp((s) => s.removeSaved);
  const rename = useApp((s) => s.renameSaved);
  const setDesign = useApp((s) => s.setDesign);
  const hydrated = useHydrated();
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [baseId, setBaseId] = useState<string | null>(null);

  // Re-predict only when the saved designs change, not on every keystroke of a rename.
  const designsKey = JSON.stringify(saved.map((s) => [s.id, s.design]));
  useEffect(() => {
    let alive = true;
    const items = JSON.parse(designsKey) as [string, Prediction["design"]][];
    Promise.all(items.map(([id, d]) => api.predict(d).then((p) => [id, p] as const)))
      .then((r) => alive && setPreds(Object.fromEntries(r)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [designsKey]);

  const base = saved.find((s) => s.id === baseId) ?? saved[0];
  const basePred = base ? preds[base.id] : undefined;

  if (hydrated && saved.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <GitCompareArrows className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Nothing to compare yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Save up to {MAX_COMPARE} designs from the Design Studio or the Optimizer. Their shapes, pressure distributions and coefficients line up
          here.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/studio" className={buttonClass("primary")}>
            Open Design Studio
          </Link>
          <Link href="/optimize" className={buttonClass("secondary")}>
            Run optimizer
          </Link>
        </div>
      </div>
    );
  }

  const rows: { label: string; get: (p: Prediction) => number; fmt: (v: number) => string; upGood: boolean | null }[] = [
    { label: "Cl", get: (p) => p.cl, fmt: (v) => v.toFixed(3), upGood: true },
    { label: "Cd (counts)", get: (p) => p.cd * 1e4, fmt: (v) => v.toFixed(0), upGood: false },
    { label: "L/D", get: (p) => p.ld, fmt: (v) => v.toFixed(1), upGood: true },
    { label: "Cm¼", get: (p) => p.cm, fmt: (v) => v.toFixed(3), upGood: null },
    { label: "Cd pressure", get: (p) => p.cdPressure * 1e4, fmt: (v) => v.toFixed(0), upGood: false },
    { label: "Cd viscous", get: (p) => p.cdViscous * 1e4, fmt: (v) => v.toFixed(0), upGood: false },
    { label: "σ(Cl)", get: (p) => p.uncertainty.cl, fmt: (v) => v.toFixed(3), upGood: false },
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Compare designs</h1>
        <p className="mt-1 text-sm text-muted">
          {saved.length} of {MAX_COMPARE} slots used. Deltas are measured against the baseline (★).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {saved.map((s, i) => {
          const p = preds[s.id];
          const isBase = base?.id === s.id;
          return (
            <Card key={s.id} className={cn("relative overflow-hidden", isBase && "ring-1 ring-accent")}>
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: SERIES[i] }} />
              <CardBody className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <input
                    aria-label="Design name"
                    className="min-w-0 flex-1 rounded bg-transparent text-sm font-semibold text-fg outline-none focus:ring-2 focus:ring-ring"
                    value={s.name}
                    placeholder={designation(s.design)}
                    onChange={(e) => rename(s.id, e.target.value)}
                    onBlur={(e) => !e.target.value.trim() && rename(s.id, `${designation(s.design).replace("≈ ", "")} @ ${s.design.aoa.toFixed(1)}°`)}
                  />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      className={cn("rounded p-1.5 hover:bg-surface-2", isBase ? "text-accent" : "text-muted")}
                      onClick={() => setBaseId(s.id)}
                      aria-label="Set as baseline"
                      title="Set as baseline"
                    >
                      <Star className="h-3.5 w-3.5" fill={isBase ? "currentColor" : "none"} />
                    </button>
                    <button
                      className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
                      onClick={() => {
                        setDesign(s.design);
                        router.push("/studio");
                      }}
                      aria-label="Open in Studio"
                      title="Open in Studio"
                    >
                      <PencilRuler className="h-3.5 w-3.5" />
                    </button>
                    <button className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-critical" onClick={() => remove(s.id)} aria-label="Remove" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="tabular mt-0.5 font-mono text-[11px] text-muted">
                  {designation(s.design)} · α {s.design.aoa.toFixed(1)}° · {s.design.speed.toFixed(0)} m/s
                </div>
                <AirfoilShape items={[{ design: s.design, color: SERIES[i] }]} annotate={false} showCamber={false} height={70} className="my-3" />
                {p ? (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ["Cl", p.cl.toFixed(3)],
                      ["Cd", `${Math.round(p.cd * 1e4)}`],
                      ["L/D", p.ld.toFixed(1)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-surface-2 py-2">
                        <div className="text-[10px] text-muted">{k}</div>
                        <div className="tabular font-mono text-sm font-semibold">{v}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Skeleton className="h-12" />
                )}
                {isBase && (
                  <Badge tone="accent" className="mt-3">
                    Baseline
                  </Badge>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Shape overlay" description="All designs at the same chord" />
          <CardBody>
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
              {saved.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-fg-2">
                  <span className="h-0.5 w-3 rounded" style={{ background: SERIES[i] }} />
                  {s.name}
                </span>
              ))}
            </div>
            <AirfoilShape items={saved.map((s, i) => ({ design: s.design, color: SERIES[i] }))} height={240} annotate={false} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Surface pressure" description="Cp: solid = upper surface, dashed = lower surface" />
          <CardBody>
            <XYChart
              height={260}
              xLabel="x/c"
              yLabel="Cp"
              yReversed
              xDomain={[0, 1]}
              xFormat={(v) => v.toFixed(1)}
              yFormat={(v) => v.toFixed(1)}
              series={saved.flatMap((s, i) => {
                const p = preds[s.id];
                if (!p) return [];
                return [
                  { id: `${s.id}u`, name: s.name, color: SERIES[i], points: p.surface.x.map((x, k) => [x, p.surface.cpUpper[k]] as [number, number]) },
                  { id: `${s.id}l`, name: s.name, color: SERIES[i], dashed: true, points: p.surface.x.map((x, k) => [x, p.surface.cpLower[k]] as [number, number]) },
                ];
              })}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Coefficient table" description="Operating point as saved for each design" />
        <CardBody>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="tabular w-full text-right text-xs">
              <thead className="bg-surface-2 text-[11px] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Metric</th>
                  {saved.map((s, i) => (
                    <th key={s.id} className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded" style={{ background: SERIES[i] }} />
                        <span className="max-w-40 truncate text-fg-2">{s.name}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <td className="px-3 py-2 text-left font-sans text-fg-2">{r.label}</td>
                    {saved.map((s) => {
                      const p = preds[s.id];
                      if (!p) return <td key={s.id} className="px-3 py-2 text-muted">…</td>;
                      const v = r.get(p);
                      const isBase = s.id === base?.id;
                      const d = basePred && !isBase ? v - r.get(basePred) : null;
                      const good = d != null && r.upGood != null && (d > 0) === r.upGood;
                      return (
                        <td key={s.id} className="px-3 py-2">
                          <span className="text-fg">{r.fmt(v)}</span>
                          {d != null && Math.abs(d) > 1e-9 && (
                            <span className={cn("ml-2 text-[10px]", r.upGood == null ? "text-muted" : good ? "text-good-text" : "text-critical")}>
                              {d > 0 ? "+" : "−"}
                              {r.fmt(Math.abs(d))}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
