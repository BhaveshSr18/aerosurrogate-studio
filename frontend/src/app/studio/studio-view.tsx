"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookmarkPlus, Download, LineChart, Link2, RotateCcw, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, buttonClass } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { DesignControls } from "@/components/design/design-controls";
import { MetricsPanel } from "@/components/design/metrics-panel";
import { ValidityPanel } from "@/components/design/validity-panel";
import { FieldCanvas } from "@/components/viz/field-canvas";
import { AirfoilShape } from "@/components/viz/airfoil-shape";
import { XYChart } from "@/components/viz/xy-chart";
import { useApp, useHydrated } from "@/lib/store";
import { useEnvelope, useField, usePrediction } from "@/lib/hooks";
import { envelopeChecks } from "@/lib/physics/envelope";
import { designation, geometry, toSelig } from "@/lib/physics/naca";
import { designFromQuery, designToQuery } from "@/lib/share";
import { FIELD_VARS } from "@/lib/colormaps";
import { DEFAULT_DESIGN } from "@/lib/presets";
import { downloadText } from "@/lib/utils";
import type { FieldVar, Prediction } from "@/lib/types";

export function StudioView() {
  const design = useApp((s) => s.design);
  const setDesign = useApp((s) => s.setDesign);
  const saveDesign = useApp((s) => s.saveDesign);
  const hydrated = useHydrated();
  const envelope = useEnvelope();
  const [variable, setVariable] = useState<FieldVar>("cp");
  const [win, setWin] = useState<"near" | "wake">("near");
  const [lines, setLines] = useState(true);

  // A shared link overrides the remembered design once persisted state is restored. The query
  // is then dropped so later edits (and a reload) are not reverted to the shared design.
  useEffect(() => {
    if (!hydrated) return;
    const fromUrl = designFromQuery(window.location.search);
    if (fromUrl) {
      setDesign(fromUrl);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [hydrated, setDesign]);

  const { pred, prev, loading, error: predError } = usePrediction(design);
  const { field, loading: fieldLoading, error: fieldError } = useField(design, win);
  const checks = useMemo(() => envelopeChecks(design, envelope), [design, envelope]);
  const loop = useMemo(() => geometry(design).loop, [design]);

  const share = async () => {
    const url = `${window.location.origin}/studio?${designToQuery(design)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "Anyone with the link opens this exact design and operating point.", "success");
    } catch {
      toast("Share link", url);
    }
  };

  const save = () => {
    const r = saveDesign(design);
    if (r.ok) toast("Saved to Compare", `${designation(design)} at α = ${design.aoa.toFixed(1)}°`, "success");
    else toast("Compare is full", r.reason, "warning");
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Design Studio</h1>
          <p className="mt-1 text-sm text-muted">Shape an airfoil, set the operating point, and read the predicted flow in real time.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDesign(DEFAULT_DESIGN)}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button variant="secondary" size="sm" onClick={share}>
            <Link2 className="h-3.5 w-3.5" /> Share
          </Button>
          <ExportMenu pred={pred} />
          <Link href="/polar" className={buttonClass("secondary", "sm")}>
            <LineChart className="h-3.5 w-3.5" /> Polars
          </Link>
          <Button size="sm" onClick={save}>
            <BookmarkPlus className="h-3.5 w-3.5" /> Save to compare
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* Controls */}
        <Card className="h-fit lg:sticky lg:top-20">
          <CardBody className="pt-4">
            <DesignControls design={design} onChange={setDesign} envelope={envelope} checks={checks} />
          </CardBody>
        </Card>

        {/* Visuals */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Flow field"
              description={FIELD_VARS.find((v) => v.key === variable)?.label}
              actions={
                <div className="hidden items-center gap-2 text-xs text-fg-2 sm:flex">
                  <span>Streamlines</span>
                  <Switch checked={lines} onCheckedChange={setLines} label="Show streamlines" />
                </div>
              }
            />
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Segmented
                  label="Field variable"
                  size="sm"
                  value={variable}
                  onChange={setVariable}
                  options={FIELD_VARS.map((v) => ({ value: v.key, label: v.short }))}
                />
                <Segmented
                  label="Field window"
                  size="sm"
                  value={win}
                  onChange={setWin}
                  options={[
                    { value: "near", label: "Near field" },
                    { value: "wake", label: "Wake" },
                  ]}
                />
              </div>
              <FieldCanvas field={field} variable={variable} loop={loop} aoa={design.aoa} showStreamlines={lines} loading={fieldLoading} error={fieldError} />
            </CardBody>
          </Card>

          <div className="grid gap-5 2xl:grid-cols-2">
            <Card>
              <CardHeader title="Surface pressure" description="Cp along the chord, suction side up" />
              <CardBody>
                <XYChart
                  height={230}
                  xLabel="x/c"
                  yLabel="Cp"
                  yReversed
                  xDomain={[0, 1]}
                  xFormat={(v) => v.toFixed(1)}
                  yFormat={(v) => v.toFixed(1)}
                  series={
                    pred
                      ? [
                          { id: "u", name: "Upper surface", color: "var(--series-1)", points: pred.surface.x.map((x, i) => [x, pred.surface.cpUpper[i]]) },
                          { id: "l", name: "Lower surface", color: "var(--series-2)", points: pred.surface.x.map((x, i) => [x, pred.surface.cpLower[i]]) },
                        ]
                      : []
                  }
                  emptyText="Waiting for prediction…"
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Geometry" description="Thickness and camber distribution" />
              <CardBody className="flex min-h-[230px] items-center">
                <AirfoilShape items={[{ design }]} height={220} />
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-5 lg:col-span-2 xl:col-span-1">
          <Card>
            <CardHeader
              title="Aerodynamic coefficients"
              description="Surrogate prediction with ensemble ±1σ"
              actions={loading && pred ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : null}
            />
            <CardBody>
              {predError && (
                <div role="alert" className="mb-3 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-fg-2">
                  <span className="font-medium text-fg">Prediction failed.</span> {predError}
                  {pred && " Showing the last successful result."}
                </div>
              )}
              <MetricsPanel pred={pred} prev={prev} loading={loading && !predError} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Trust & validity" description="Where this prediction stands" />
            <CardBody>
              <ValidityPanel pred={pred} />
            </CardBody>
          </Card>
          <Link
            href="/optimize"
            className="group flex items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 text-sm transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <Sparkles className="h-4 w-4 text-accent" />
            <div className="flex-1">
              <div className="font-medium text-fg">Optimize from here</div>
              <div className="text-xs text-muted">Let the optimizer search the design space around this shape.</div>
            </div>
            <span className="text-muted transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ExportMenu({ pred }: { pred: Prediction | null }) {
  const [open, setOpen] = useState(false);
  const design = useApp((s) => s.design);
  const name = designation(design).replace("≈ ", "").replace(" ", "_");
  const items = [
    {
      label: "Coordinates (.dat, Selig)",
      run: () => downloadText(`${name}.dat`, toSelig(design, designation(design).replace("≈ ", ""))),
    },
    {
      label: "Coefficients (.json)",
      run: () =>
        pred &&
        downloadText(
          `${name}_prediction.json`,
          JSON.stringify({ ...pred, surface: undefined }, null, 2),
          "application/json",
        ),
    },
    {
      label: "Surface Cp (.csv)",
      run: () =>
        pred &&
        downloadText(
          `${name}_cp.csv`,
          "x_c,cp_upper,cp_lower\n" + pred.surface.x.map((x, i) => `${x.toFixed(5)},${pred.surface.cpUpper[i].toFixed(5)},${pred.surface.cpLower[i].toFixed(5)}`).join("\n"),
          "text/csv",
        ),
    },
  ];
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download className="h-3.5 w-3.5" /> Export
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1.5 w-60 rounded-lg border border-border bg-surface p-1 shadow-card">
            {items.map((it) => (
              <button
                key={it.label}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-surface-2"
                onClick={() => {
                  it.run();
                  setOpen(false);
                }}
              >
                {it.label}
              </button>
            ))}
            <div className="mt-1 border-t border-border px-3 py-2 text-[11px] text-muted">VTK fields and PDF report arrive with the backend.</div>
          </div>
        </>
      )}
    </div>
  );
}
