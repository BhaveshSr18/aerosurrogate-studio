"use client";

import { AlertOctagon, ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Prediction } from "@/lib/types";
import { Skeleton } from "@/components/ui/misc";
import { InfoTip } from "@/components/ui/tooltip";
import { counts } from "@/lib/format";
import { cn } from "@/lib/utils";

function Kpi({
  label,
  value,
  sigma,
  unit,
  hint,
  delta,
  deltaGoodWhenUp = true,
  loading,
  emphasis,
}: {
  label: string;
  value: string;
  sigma?: string;
  unit?: string;
  hint: string;
  delta?: number;
  deltaGoodWhenUp?: boolean;
  loading?: boolean;
  emphasis?: boolean;
}) {
  const showDelta = delta != null && Math.abs(delta) > 1e-6;
  const good = showDelta && (delta! > 0) === deltaGoodWhenUp;
  return (
    <div className={cn("rounded-xl border border-border p-3.5", emphasis ? "bg-accent-soft" : "bg-surface-2")}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted">
          {label}
          <InfoTip>{hint}</InfoTip>
        </span>
        {showDelta && !loading && (
          <span className={cn("tabular flex items-center font-mono text-[10px]", good ? "text-good-text" : "text-critical")}>
            {delta! > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta!).toFixed(label === "Cd" ? 0 : label === "L/D" ? 1 : 3)}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tracking-tight text-fg">{value}</span>
          {unit && <span className="text-xs text-muted">{unit}</span>}
        </div>
      )}
      {sigma && !loading && <div className="tabular mt-0.5 font-mono text-[11px] text-muted">± {sigma} (1σ)</div>}
    </div>
  );
}

export function MetricsPanel({ pred, prev, loading }: { pred: Prediction | null; prev?: Prediction | null; loading?: boolean }) {
  const p = pred;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi
          label="Cl"
          hint="Lift coefficient from integrated surface pressure and wall shear."
          value={p ? p.cl.toFixed(3) : "—"}
          sigma={p?.uncertainty.cl.toFixed(3)}
          delta={p && prev ? p.cl - prev.cl : undefined}
          loading={loading && !p}
        />
        <Kpi
          label="Cd"
          hint="Drag coefficient in counts (1 count = 0.0001). Lower is better."
          value={p ? counts(p.cd) : "—"}
          unit="counts"
          sigma={p ? counts(p.uncertainty.cd) : undefined}
          delta={p && prev ? (p.cd - prev.cd) * 1e4 : undefined}
          deltaGoodWhenUp={false}
          loading={loading && !p}
        />
        <Kpi
          label="L/D"
          hint="Lift-to-drag ratio, the main efficiency metric."
          value={p ? p.ld.toFixed(1) : "—"}
          sigma={p?.uncertainty.ld.toFixed(1)}
          delta={p && prev ? p.ld - prev.ld : undefined}
          loading={loading && !p}
          emphasis
        />
        <Kpi
          label="Cm¼"
          hint="Pitching-moment coefficient about the quarter chord (positive nose-up)."
          value={p ? p.cm.toFixed(3) : "—"}
          loading={loading && !p}
        />
      </div>
      {p?.stalled && (
        <div className="flex items-start gap-2 rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-xs text-fg-2">
          <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />
          <span>
            <span className="font-medium text-fg">Separated flow likely.</span> The surrogate is less reliable past stall; the uncertainty
            band widens.
          </span>
        </div>
      )}
      {p && <DragBreakdown pred={p} />}
    </div>
  );
}

function DragBreakdown({ pred }: { pred: Prediction }) {
  const total = pred.cdPressure + pred.cdViscous;
  const fp = (pred.cdPressure / total) * 100;
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3.5">
      <div className="mb-2.5 flex items-center justify-between text-[11px] font-medium text-muted">
        <span className="flex items-center gap-1">
          Drag breakdown
          <InfoTip>Pressure (form) drag versus viscous (skin-friction) drag, both from surface integration of the predicted fields.</InfoTip>
        </span>
        <span className="tabular font-mono">{counts(total)} counts</span>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-l-full bg-series-1" style={{ width: `${fp}%` }} />
        <div className="flex-1 rounded-r-full bg-series-2" />
      </div>
      <div className="mt-2 flex justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-fg-2">
          <span className="h-2 w-2 rounded-sm bg-series-1" /> Pressure <span className="tabular font-mono text-fg">{counts(pred.cdPressure)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-fg-2">
          <span className="h-2 w-2 rounded-sm bg-series-2" /> Viscous <span className="tabular font-mono text-fg">{counts(pred.cdViscous)}</span>
        </span>
      </div>
    </div>
  );
}
