"use client";

import { Boxes, Cpu, ShieldCheck } from "lucide-react";
import type { Prediction } from "@/lib/types";
import { StatusIcon, Badge, Skeleton } from "@/components/ui/misc";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ValidityPanel({ pred }: { pred: Prediction | null }) {
  if (!pred) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  const worst = pred.envelope.some((c) => c.status === "fail") ? "fail" : pred.envelope.some((c) => c.status === "warn") ? "warn" : "pass";
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
            <ShieldCheck className="h-3.5 w-3.5 text-muted" />
            Training envelope
            <InfoTip>
              How far each input is from the data the surrogate was trained on. Values outside the range are extrapolations. The ranges shown are
              provisional until the backend reports the actual training-split bounds.
            </InfoTip>
          </span>
          <Badge tone={worst === "pass" ? "good" : worst === "warn" ? "warning" : "critical"}>
            <StatusIcon status={worst} className="h-3 w-3" />
            {worst === "pass" ? "In distribution" : worst === "warn" ? "Near edge" : "Extrapolating"}
          </Badge>
        </div>
        <ul className="space-y-1.5">
          {pred.envelope.map((c) => {
            const pos = Math.min(1, Math.max(0, (c.value - c.min) / (c.max - c.min)));
            return (
              <li key={c.key} className="grid grid-cols-[14px_1fr_64px] items-center gap-2 text-[11px]" title={c.message}>
                <StatusIcon status={c.status} />
                <div>
                  <div className="flex justify-between text-fg-2">
                    <span>{c.label}</span>
                  </div>
                  <div className="relative mt-1 h-1 rounded-full bg-surface-3">
                    <div
                      className={cn(
                        "absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full",
                        c.status === "pass" ? "bg-fg-2" : c.status === "warn" ? "bg-warning" : "bg-critical",
                      )}
                      style={{ left: `calc(${pos * 100}% - 1px)` }}
                    />
                  </div>
                </div>
                <span className="tabular text-right font-mono text-fg">{c.value.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border pt-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
            <Boxes className="h-3.5 w-3.5 text-muted" />
            Mesh morphing
            <InfoTip>
              New shapes are meshed by morphing the nearest AirfRANS training mesh onto the design. Cell quality is checked before inference.
              Values here are placeholders until the morphing engine exists.
            </InfoTip>
          </span>
          <Badge tone={pred.mesh.status === "pass" ? "good" : "warning"}>
            <StatusIcon status={pred.mesh.status} className="h-3 w-3" />
            {pred.mesh.status === "pass" ? "Quality OK" : "Check"}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <dt className="text-muted">Base case</dt>
          <dd className="truncate text-right font-mono text-fg-2" title={pred.mesh.baseCase}>
            {pred.mesh.baseCase}
          </dd>
          <dt className="text-muted">Max displacement</dt>
          <dd className="tabular text-right font-mono text-fg">{(pred.mesh.maxSurfaceDisplacement * 100).toFixed(2)}% c</dd>
          <dt className="text-muted">Min cell quality</dt>
          <dd className="tabular text-right font-mono text-fg">{pred.mesh.minCellQuality.toFixed(2)}</dd>
          <dt className="text-muted">Nodes</dt>
          <dd className="tabular text-right font-mono text-fg">{pred.mesh.nodes.toLocaleString("en-US")}</dd>
        </dl>
      </div>

      <div className="border-t border-border pt-3.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
            <Cpu className="h-3.5 w-3.5 text-muted" />
            Inference
          </span>
          <span className="tabular font-mono text-muted">{pred.modelVersion}</span>
        </div>
        <div className="tabular mt-1.5 font-mono text-[11px] text-muted">
          {pred.timingMs < 1 ? "<1" : pred.timingMs.toFixed(0)} ms · Re {(pred.reynolds / 1e6).toFixed(2)} M · id {pred.id}
        </div>
      </div>
    </div>
  );
}
