"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface XYSeries {
  id: string;
  name: string;
  color: string;
  points: [number, number][];
  kind?: "line" | "scatter";
  dashed?: boolean;
  markers?: boolean;
  /** Uncertainty band [x, lo, hi] */
  band?: [number, number, number][];
  /** Scatter only: optional per-point color override (e.g. infeasible = muted). */
  pointColors?: string[];
  size?: number;
}

export interface RefLine {
  x?: number;
  y?: number;
  label?: string;
}

function niceTicks(lo: number, hi: number, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-12) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Tick labels get just enough decimals for their step, so labels never repeat. */
function tickLabel(v: number, ticks: number[], fmt: (v: number) => string) {
  if (ticks.length < 2) return fmt(v);
  const step = Math.abs(ticks[1] - ticks[0]);
  const labels = ticks.map(fmt);
  if (new Set(labels).size === labels.length) return fmt(v);
  const d = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) + 1e-9) + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0)));
  return v.toFixed(d);
}

export function XYChart({
  series,
  xLabel,
  yLabel,
  height = 240,
  yReversed,
  xDomain,
  yDomain,
  xFormat = (v) => String(Number(v.toFixed(3))),
  yFormat = (v) => String(Number(v.toFixed(3))),
  refLines = [],
  className,
  legend = "auto",
  emptyText = "No data",
}: {
  series: XYSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  yReversed?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  refLines?: RefLine[];
  className?: string;
  legend?: "auto" | "none";
  emptyText?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const clipId = `clip-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = { l: 52, r: 16, t: 10, b: 38 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const { xd, yd, xt, yt } = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    const ys = series.flatMap((s) => [...s.points.map((p) => p[1]), ...(s.band ?? []).flatMap((b) => [b[1], b[2]])]);
    const finite = (a: number[]) => a.filter(Number.isFinite);
    const fx = finite(xs);
    const fy = finite(ys);
    let xd: [number, number] = xDomain ?? [Math.min(...fx), Math.max(...fx)];
    let yd: [number, number] = yDomain ?? [Math.min(...fy), Math.max(...fy)];
    if (!fx.length) xd = [0, 1];
    if (!fy.length) yd = [0, 1];
    if (!yDomain) {
      const pad = (yd[1] - yd[0]) * 0.08 || 0.1;
      yd = [yd[0] - pad, yd[1] + pad];
    }
    const xt = niceTicks(xd[0], xd[1], Math.max(3, Math.floor(iw / 80)));
    const yt = niceTicks(yd[0], yd[1], 5);
    if (!yDomain) yd = [Math.min(yd[0], yt[0]), Math.max(yd[1], yt[yt.length - 1])];
    return { xd, yd, xt, yt };
  }, [series, xDomain, yDomain, iw]);

  const sx = (x: number) => m.l + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * iw;
  const sy = (y: number) => (yReversed ? m.t + ((y - yd[0]) / (yd[1] - yd[0] || 1)) * ih : m.t + ih - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * ih);

  const empty = series.every((s) => s.points.length === 0);

  // Hover: line series -> value at nearest x; scatter -> nearest point on screen. Cheap enough
  // to recompute every render, which keeps it in sync with every scale input.
  const tip = (() => {
    if (!hover || empty) return null;
    const x = xd[0] + ((hover.px - m.l) / iw) * (xd[1] - xd[0]);
    const lineRows: { s: XYSeries; p: [number, number] }[] = [];
    let best: { s: XYSeries; p: [number, number]; d: number } | null = null;
    for (const s of series) {
      if (!s.points.length) continue;
      if (s.kind === "scatter") {
        for (const p of s.points) {
          const d = Math.hypot(sx(p[0]) - hover.px, sy(p[1]) - hover.py);
          if (d < 24 && (!best || d < best.d)) best = { s, p, d };
        }
      } else {
        let nearest = s.points[0];
        for (const p of s.points) if (Math.abs(p[0] - x) < Math.abs(nearest[0] - x)) nearest = p;
        lineRows.push({ s, p: nearest });
      }
    }
    return { x, lineRows, best };
  })();

  const showLegend = legend === "auto" && series.filter((s) => s.name).length >= 2;
  const legendItems = series.filter((s, i, arr) => s.name && arr.findIndex((o) => o.name === s.name) === i);

  return (
    <div className={cn("w-full", className)}>
      {showLegend && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {legendItems.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-fg-2">
              {s.kind === "scatter" ? (
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              ) : (
                <svg width="16" height="6" aria-hidden="true">
                  <line x1="0" x2="16" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
                </svg>
              )}
              {s.name}
            </div>
          ))}
        </div>
      )}
      <div ref={wrapRef} className="relative w-full min-w-0" style={{ height }}>
        {/* Absolutely positioned so the SVG never widens its container before the first measure. */}
        <svg
          width={width}
          height={height}
          className="absolute top-0 left-0 block touch-pan-y overflow-visible"
          role="img"
          aria-label={`${yLabel} versus ${xLabel}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            setHover(px >= m.l && px <= m.l + iw && py >= m.t && py <= m.t + ih ? { px, py } : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {/* grid */}
          {yt.map((v) => (
            <line key={`gy${v}`} x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
          ))}
          {xt.map((v) => (
            <line key={`gx${v}`} y1={m.t} y2={m.t + ih} x1={sx(v)} x2={sx(v)} stroke="var(--grid)" strokeWidth={1} opacity={0.6} />
          ))}
          {/* zero line */}
          {yd[0] < 0 && yd[1] > 0 && <line x1={m.l} x2={m.l + iw} y1={sy(0)} y2={sy(0)} stroke="var(--axis)" strokeWidth={1} />}
          {/* axes ticks */}
          {yt.map((v) => (
            <text key={`ty${v}`} x={m.l - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">
              {tickLabel(v, yt, yFormat)}
            </text>
          ))}
          {xt.map((v) => (
            <text key={`tx${v}`} x={sx(v)} y={m.t + ih + 16} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tabular">
              {tickLabel(v, xt, xFormat)}
            </text>
          ))}
          <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke="var(--axis)" />
          <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--fg-2)">
            {xLabel}
          </text>
          <text transform={`translate(12 ${m.t + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--fg-2)">
            {yLabel}
          </text>

          <defs>
            <clipPath id={clipId}>
              <rect x={m.l} y={m.t - 2} width={iw} height={ih + 4} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {refLines.map((r, i) =>
              r.y != null ? (
                <g key={i}>
                  <line x1={m.l} x2={m.l + iw} y1={sy(r.y)} y2={sy(r.y)} stroke="var(--fg-2)" strokeDasharray="4 4" strokeWidth={1} />
                  {r.label && (
                    <text x={m.l + iw - 4} y={sy(r.y) - 5} textAnchor="end" fontSize={10} fill="var(--fg-2)">
                      {r.label}
                    </text>
                  )}
                </g>
              ) : r.x != null ? (
                <g key={i}>
                  <line y1={m.t} y2={m.t + ih} x1={sx(r.x)} x2={sx(r.x)} stroke="var(--fg-2)" strokeDasharray="4 4" strokeWidth={1} />
                  {r.label && (
                    <text x={sx(r.x) + 4} y={m.t + 10} fontSize={10} fill="var(--fg-2)">
                      {r.label}
                    </text>
                  )}
                </g>
              ) : null,
            )}
            {series.map((s) =>
              s.band && s.band.length ? (
                <path
                  key={`b${s.id}`}
                  d={
                    s.band.map((b, i) => `${i ? "L" : "M"}${sx(b[0])},${sy(b[2])}`).join("") +
                    s.band
                      .slice()
                      .reverse()
                      .map((b) => `L${sx(b[0])},${sy(b[1])}`)
                      .join("") +
                    "Z"
                  }
                  fill={s.color}
                  opacity={0.14}
                />
              ) : null,
            )}
            {series.map((s) =>
              s.kind === "scatter" ? (
                <g key={s.id}>
                  {s.points.map((p, i) => (
                    <circle
                      key={i}
                      cx={sx(p[0])}
                      cy={sy(p[1])}
                      r={s.size ?? 4}
                      fill={s.pointColors?.[i] ?? s.color}
                      stroke="var(--surface)"
                      strokeWidth={1.5}
                      opacity={0.9}
                    />
                  ))}
                </g>
              ) : (
                <g key={s.id}>
                  <path
                    d={s.points
                      .filter((p) => Number.isFinite(p[1]))
                      .map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`)
                      .join("")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {s.markers &&
                    s.points.map((p, i) => (
                      <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
                    ))}
                </g>
              ),
            )}
          </g>

          {/* hover layer */}
          {tip && tip.lineRows.length > 0 && (
            <g pointerEvents="none">
              <line x1={sx(tip.lineRows[0].p[0])} x2={sx(tip.lineRows[0].p[0])} y1={m.t} y2={m.t + ih} stroke="var(--fg-2)" strokeWidth={1} opacity={0.5} />
              {tip.lineRows.map(({ s, p }) => (
                <circle key={s.id} cx={sx(p[0])} cy={sy(p[1])} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          {tip?.best && (
            <circle pointerEvents="none" cx={sx(tip.best.p[0])} cy={sy(tip.best.p[1])} r={7} fill="none" stroke="var(--fg)" strokeWidth={1.5} />
          )}
        </svg>
        {empty && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">{emptyText}</div>}
        {tip && hover && (tip.lineRows.length > 0 || tip.best) && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-border bg-surface/95 px-2.5 py-2 text-[11px] shadow-card backdrop-blur"
            style={{ left: Math.min(hover.px + 14, width - 170), top: Math.max(0, hover.py - 20) }}
          >
            {tip.best ? (
              <>
                <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
                  <span className="h-2 w-2 rounded-full" style={{ background: tip.best.s.color }} />
                  {tip.best.s.name}
                </div>
                <div className="tabular font-mono text-fg-2">
                  {xLabel}: {xFormat(tip.best.p[0])}
                </div>
                <div className="tabular font-mono text-fg-2">
                  {yLabel}: {yFormat(tip.best.p[1])}
                </div>
              </>
            ) : (
              <>
                <div className="tabular mb-1 font-mono text-muted">
                  {xLabel} = {xFormat(tip.lineRows[0].p[0])}
                </div>
                {tip.lineRows.map(({ s, p }) => (
                  <div key={s.id} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-fg-2">
                      <span className="h-0.5 w-2.5 rounded" style={{ background: s.color }} />
                      {s.name || yLabel}
                    </span>
                    <span className="tabular font-mono font-medium text-fg">{yFormat(p[1])}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
