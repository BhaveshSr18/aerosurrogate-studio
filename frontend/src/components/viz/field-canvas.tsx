"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type { FieldData, FieldVar, Point } from "@/lib/types";
import { colormapToCss, diverging, FIELD_VARS, robustRange, sequential, type Theme } from "@/lib/colormaps";
import { cn } from "@/lib/utils";

function sample(arr: Float32Array, f: FieldData, x: number, y: number) {
  const fx = ((x - f.xmin) / (f.xmax - f.xmin)) * f.nx - 0.5;
  const fy = ((y - f.ymin) / (f.ymax - f.ymin)) * f.ny - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= f.nx - 1 || j >= f.ny - 1) return NaN;
  const tx = fx - i;
  const ty = fy - j;
  const k = j * f.nx + i;
  return (
    arr[k] * (1 - tx) * (1 - ty) + arr[k + 1] * tx * (1 - ty) + arr[k + f.nx] * (1 - tx) * ty + arr[k + f.nx + 1] * tx * ty
  );
}

export function streamlines(f: FieldData, count = 26, h = 0.006, maxSteps = 1400): Point[][] {
  const lines: Point[][] = [];
  const span = f.ymax - f.ymin;
  for (let s = 0; s < count; s++) {
    let x = f.xmin + 0.01;
    let y = f.ymin + ((s + 0.5) / count) * span;
    const pts: Point[] = [[x, y]];
    for (let n = 0; n < maxSteps; n++) {
      const u1 = sample(f.u, f, x, y);
      const v1 = sample(f.v, f, x, y);
      if (!Number.isFinite(u1) || !Number.isFinite(v1)) break;
      const m1 = Math.hypot(u1, v1) || 1;
      const xm = x + (0.5 * h * u1) / m1;
      const ym = y + (0.5 * h * v1) / m1;
      const u2 = sample(f.u, f, xm, ym);
      const v2 = sample(f.v, f, xm, ym);
      if (!Number.isFinite(u2) || !Number.isFinite(v2)) break;
      const m2 = Math.hypot(u2, v2) || 1;
      x += (h * u2) / m2;
      y += (h * v2) / m2;
      if (x > f.xmax || y < f.ymin || y > f.ymax) break;
      pts.push([x, y]);
    }
    lines.push(pts);
  }
  return lines;
}

export function FieldCanvas({
  field,
  variable,
  loop,
  aoa,
  showStreamlines = true,
  loading,
  error,
  className,
}: {
  field: FieldData | null;
  variable: FieldVar;
  loop: Point[];
  aoa: number;
  showStreamlines?: boolean;
  loading?: boolean;
  error?: string | null;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [probe, setProbe] = useState<{ px: number; py: number; x: number; y: number; v: number } | null>(null);
  const { resolvedTheme } = useTheme();
  const theme: Theme = resolvedTheme === "light" ? "light" : "dark";
  const meta = FIELD_VARS.find((m) => m.key === variable)!;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lut = useMemo(() => (meta.kind === "diverging" ? diverging(theme) : sequential(theme)), [meta.kind, theme]);
  const range = useMemo(() => (field ? robustRange(field.vars[variable], meta) : ([0, 1] as [number, number])), [field, variable, meta]);
  const lines = useMemo(() => (field && showStreamlines ? streamlines(field) : []), [field, showStreamlines]);

  const aspect = field ? field.ny / field.nx : 0.5;
  const height = Math.round(width * aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !field) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Raster the field at grid resolution, then scale up with smoothing.
    const off = document.createElement("canvas");
    off.width = field.nx;
    off.height = field.ny;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(field.nx, field.ny);
    const data = field.vars[variable];
    const [lo, hi] = range;
    const inv = 1 / (hi - lo || 1);
    for (let j = 0; j < field.ny; j++) {
      const row = field.ny - 1 - j;
      for (let i = 0; i < field.nx; i++) {
        const k = j * field.nx + i;
        const o = (row * field.nx + i) * 4;
        const val = data[k];
        if (!Number.isFinite(val)) {
          img.data[o + 3] = 0;
          continue;
        }
        const t = Math.min(255, Math.max(0, Math.round((val - lo) * inv * 255)));
        img.data[o] = lut[t * 3];
        img.data[o + 1] = lut[t * 3 + 1];
        img.data[o + 2] = lut[t * 3 + 2];
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, width, height);

    const sx = (x: number) => ((x - field.xmin) / (field.xmax - field.xmin)) * width;
    const sy = (y: number) => height - ((y - field.ymin) / (field.ymax - field.ymin)) * height;

    if (lines.length) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.42)" : "rgba(11,11,11,0.38)";
      for (const l of lines) {
        ctx.beginPath();
        l.forEach(([x, y], n) => (n ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      }
    }

    // Airfoil body
    ctx.beginPath();
    loop.forEach(([x, y], n) => (n ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath();
    ctx.fillStyle = theme === "dark" ? "#2c2c2a" : "#e8e7e2";
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme === "dark" ? "#c3c2b7" : "#52514e";
    ctx.stroke();
  }, [field, variable, range, lut, lines, loop, width, height, theme]);

  const onMove = (e: React.PointerEvent) => {
    if (!field) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = field.xmin + (px / rect.width) * (field.xmax - field.xmin);
    const y = field.ymax - (py / rect.height) * (field.ymax - field.ymin);
    const v = sample(field.vars[variable], field, x, y);
    setProbe({ px, py, x, y, v });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-surface-2"
        style={{ height: field ? height : undefined, aspectRatio: field ? undefined : "2 / 1" }}
        onPointerMove={onMove}
        onPointerLeave={() => setProbe(null)}
      >
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          className={cn("absolute top-0 left-0 block transition-opacity duration-300", loading && "opacity-40")}
        />
        {!field && !error && <div className="absolute inset-0 animate-pulse bg-surface-3/40" />}
        {error && (
          <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg border border-critical/30 bg-surface/95 px-3 py-2 text-xs text-fg-2">
            <span className="font-medium text-fg">Flow field unavailable.</span> {error} Change any input to retry.
          </div>
        )}
        {loading && (
          <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] text-fg-2 backdrop-blur">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Inferring fields…
          </div>
        )}
        <InflowIndicator aoa={aoa} />
        {probe && Number.isFinite(probe.v) && (
          <>
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg/30" style={{ left: probe.px }} />
            <div className="pointer-events-none absolute right-0 left-0 h-px bg-fg/30" style={{ top: probe.py }} />
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-card backdrop-blur"
              style={{
                left: Math.min(probe.px + 12, width - 150),
                top: Math.max(4, Math.min(probe.py + 12, height - 60)),
              }}
            >
              <div className="tabular font-mono text-fg">
                {meta.short} = <span className="font-semibold">{probe.v.toFixed(meta.digits + 1)}</span> {meta.unit}
              </div>
              <div className="tabular font-mono text-muted">
                x/c {probe.x.toFixed(3)} · y/c {probe.y.toFixed(3)}
              </div>
            </div>
          </>
        )}
      </div>
      <Colorbar lut={lut} range={range} label={`${meta.label}${meta.unit ? ` (${meta.unit})` : ""}`} digits={meta.digits} />
    </div>
  );
}

function InflowIndicator({ aoa }: { aoa: number }) {
  return (
    <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-full border border-border bg-surface/85 px-2.5 py-1 text-[11px] text-fg-2 backdrop-blur">
      <svg width="26" height="14" viewBox="-13 -7 26 14" aria-hidden="true">
        <g transform={`rotate(${-aoa})`}>
          <line x1="-10" y1="0" x2="8" y2="0" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 0 L3 -3.5 L3 3.5 Z" fill="currentColor" />
        </g>
      </svg>
      <span className="tabular font-mono">U∞ · α {aoa.toFixed(1)}°</span>
    </div>
  );
}

export function Colorbar({ lut, range, label, digits }: { lut: Uint8ClampedArray; range: [number, number]; label: string; digits: number }) {
  const [lo, hi] = range;
  const mid = (lo + hi) / 2;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] whitespace-nowrap text-muted">{label}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full" style={{ background: colormapToCss(lut) }} />
        <div className="tabular mt-1 flex justify-between font-mono text-[10px] text-muted">
          <span>{lo.toFixed(digits)}</span>
          <span>{mid.toFixed(digits)}</span>
          <span>{hi.toFixed(digits)}</span>
        </div>
      </div>
    </div>
  );
}
