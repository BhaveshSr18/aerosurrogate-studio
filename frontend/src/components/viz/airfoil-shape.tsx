"use client";

import { useMemo } from "react";
import type { Design } from "@/lib/types";
import { geometry } from "@/lib/physics/naca";
import { cn } from "@/lib/utils";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

interface ShapeItem {
  design: Design;
  label?: string;
  color?: string;
  dashed?: boolean;
}

/** Airfoil outline(s) in chord units. Multiple items overlay for comparison. */
export function AirfoilShape({
  items,
  showCamber = true,
  annotate = true,
  className,
  height = 150,
}: {
  items: ShapeItem[];
  showCamber?: boolean;
  annotate?: boolean;
  className?: string;
  height?: number;
}) {
  const geos = useMemo(() => items.map((it) => geometry(it.design, 100)), [items]);
  const W = 1000;
  const pad = 40;
  const ext = Math.max(0.12, ...geos.flatMap((g) => g.loop.map(([, y]) => Math.abs(y)))) * 1.25;
  const H = Math.round(((2 * ext) / 1.1) * (W - 2 * pad)) + 2 * pad * 0.6;
  const sx = (x: number) => pad + ((x + 0.05) / 1.1) * (W - 2 * pad);
  const sy = (y: number) => H / 2 - (y / 1.1) * (W - 2 * pad);
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("");
  const main = geos[0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full", className)} style={{ maxHeight: height }} role="img" aria-label="Airfoil geometry">
      <line x1={sx(0)} x2={sx(1)} y1={sy(0)} y2={sy(0)} stroke="var(--axis)" strokeDasharray="4 6" strokeWidth={1.5} />
      {geos.map((g, i) => (
        <g key={i}>
          <path
            d={path(g.loop) + "Z"}
            fill={items.length === 1 ? "var(--accent-soft)" : "none"}
            stroke={items[i].color ?? "var(--accent)"}
            strokeWidth={items.length === 1 ? 3 : 2.5}
            strokeDasharray={items[i].dashed ? "10 7" : undefined}
            strokeLinejoin="round"
          />
          {showCamber && items.length === 1 && (
            <path d={path(g.camber)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="6 6" />
          )}
        </g>
      ))}
      {annotate && items.length === 1 && main && (
        <g className="tabular" fontFamily="var(--font-mono)" fontSize={22} fill="var(--muted)">
          <line
            x1={sx(main.maxThickness.x)}
            x2={sx(main.maxThickness.x)}
            y1={sy(main.maxCamber.c * 0 + interpY(main.upper, main.maxThickness.x))}
            y2={sy(interpY(main.lower, main.maxThickness.x))}
            stroke="var(--fg-2)"
            strokeWidth={1.5}
            markerStart="url(#tick)"
            markerEnd="url(#tick)"
          />
          <text x={sx(main.maxThickness.x) + 10} y={sy(interpY(main.upper, main.maxThickness.x)) - 12}>
            t/c {(main.maxThickness.t * 100).toFixed(1)}% @ {(main.maxThickness.x * 100).toFixed(0)}%
          </text>
          <text x={sx(0)} y={H - 8}>
            LE
          </text>
          <text x={sx(1) - 28} y={H - 8}>
            TE
          </text>
          {Math.abs(main.maxCamber.c) > 1e-4 && (
            <text x={sx(0.62)} y={H - 8}>
              camber {(main.maxCamber.c * 100).toFixed(2)}% @ {(main.maxCamber.x * 100).toFixed(0)}%
            </text>
          )}
          <defs>
            <marker id="tick" viewBox="-5 -1 10 2" markerWidth="10" markerHeight="2" orient="auto">
              <line x1="-5" x2="5" y1="0" y2="0" stroke="var(--fg-2)" strokeWidth={2} transform="rotate(90)" />
            </marker>
          </defs>
        </g>
      )}
    </svg>
  );
}

function interpY(pts: [number, number][], x: number) {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= x) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return pts[pts.length - 1][1];
}
