"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { api } from "@/lib/api/client";
import { geometry } from "@/lib/physics/naca";
import { diverging, robustRange, FIELD_VARS } from "@/lib/colormaps";
import type { Design, FieldData } from "@/lib/types";
import { streamlines } from "./field-canvas";

const HERO_DESIGN: Design = { family: "4", naca4: { M: 4, P: 4, T: 12 }, naca5: { L: 2, P: 3, Q: 0, T: 12 }, aoa: 6, speed: 50 };

function sampler(f: FieldData) {
  return (arr: Float32Array, x: number, y: number) => {
    const fx = ((x - f.xmin) / (f.xmax - f.xmin)) * f.nx - 0.5;
    const fy = ((y - f.ymin) / (f.ymax - f.ymin)) * f.ny - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= f.nx - 1 || j >= f.ny - 1) return NaN;
    const tx = fx - i;
    const ty = fy - j;
    const k = j * f.nx + i;
    return arr[k] * (1 - tx) * (1 - ty) + arr[k + 1] * tx * (1 - ty) + arr[k + f.nx] * (1 - tx) * ty + arr[k + f.nx + 1] * tx * ty;
  };
}

/** Animated particles advected through the (placeholder) predicted velocity field. */
export function HeroFlow({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const [field, setField] = useState<FieldData | null>(null);
  const [size, setSize] = useState({ w: 720, h: 360 });
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  useEffect(() => {
    api.field(HERO_DESIGN, "near").then(setField).catch(() => {});
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.width / 2 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!field) return;
    const { w, h } = size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const loop = geometry(HERO_DESIGN).loop;
    const sx = (x: number) => ((x - field.xmin) / (field.xmax - field.xmin)) * w;
    const sy = (y: number) => h - ((y - field.ymin) / (field.ymax - field.ymin)) * h;

    // Static background: faint pressure field + airfoil.
    const bg = bgRef.current!;
    bg.width = w * dpr;
    bg.height = h * dpr;
    const b = bg.getContext("2d")!;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const off = document.createElement("canvas");
    off.width = field.nx;
    off.height = field.ny;
    const o = off.getContext("2d")!;
    const img = o.createImageData(field.nx, field.ny);
    const lut = diverging(dark ? "dark" : "light");
    const meta = FIELD_VARS[0];
    const [lo, hi] = robustRange(field.vars.cp, meta);
    for (let j = 0; j < field.ny; j++)
      for (let i = 0; i < field.nx; i++) {
        const k = j * field.nx + i;
        const v = field.vars.cp[k];
        const p = ((field.ny - 1 - j) * field.nx + i) * 4;
        if (!Number.isFinite(v)) continue;
        const t = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)));
        img.data[p] = lut[t * 3];
        img.data[p + 1] = lut[t * 3 + 1];
        img.data[p + 2] = lut[t * 3 + 2];
        img.data[p + 3] = 255;
      }
    o.putImageData(img, 0, 0);
    b.clearRect(0, 0, w, h);
    b.globalAlpha = dark ? 0.55 : 0.5;
    b.imageSmoothingQuality = "high";
    b.drawImage(off, 0, 0, w, h);
    b.globalAlpha = 1;
    b.beginPath();
    loop.forEach(([x, y], n) => (n ? b.lineTo(sx(x), sy(y)) : b.moveTo(sx(x), sy(y))));
    b.closePath();
    b.fillStyle = dark ? "#1a1a19" : "#fcfcfb";
    b.fill();
    b.strokeStyle = dark ? "#c3c2b7" : "#52514e";
    b.lineWidth = 1.5;
    b.stroke();

    const fg = fgRef.current!;
    fg.width = w * dpr;
    fg.height = h * dpr;
    const c = fg.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = dark ? "rgba(255,255,255,0.8)" : "rgba(11,11,11,0.7)";

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      c.strokeStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(11,11,11,0.35)";
      for (const l of streamlines(field, 30)) {
        c.beginPath();
        l.forEach(([x, y], n) => (n ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y))));
        c.stroke();
      }
      return;
    }

    const S = sampler(field);
    const N = Math.round((w * h) / 380);
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const age = new Float32Array(N);
    const spawn = (i: number, anywhere: boolean) => {
      px[i] = anywhere ? field.xmin + Math.random() * (field.xmax - field.xmin) : field.xmin + Math.random() * 0.05;
      py[i] = field.ymin + Math.random() * (field.ymax - field.ymin);
      age[i] = Math.random() * 200;
    };
    for (let i = 0; i < N; i++) spawn(i, true);
    const dt = 0.0045;
    let raf = 0;
    const tick = () => {
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "rgba(0,0,0,0.09)";
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = ink;
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < N; i++) {
        const u = S(field.u, px[i], py[i]);
        const v = S(field.v, px[i], py[i]);
        if (!Number.isFinite(u) || !Number.isFinite(v) || age[i] > 260) {
          spawn(i, false);
          continue;
        }
        const x0 = sx(px[i]);
        const y0 = sy(py[i]);
        px[i] += u * dt;
        py[i] += v * dt;
        age[i] += 1;
        c.moveTo(x0, y0);
        c.lineTo(sx(px[i]), sy(py[i]));
        if (px[i] > field.xmax) spawn(i, false);
      }
      c.stroke();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [field, size, dark]);

  return (
    <div ref={wrapRef} className={className} style={{ height: size.h }}>
      <div className="relative h-full w-full">
        <canvas ref={bgRef} className="absolute inset-0" style={{ width: size.w, height: size.h }} />
        <canvas ref={fgRef} className="absolute inset-0" style={{ width: size.w, height: size.h }} />
        {!field && <div className="absolute inset-0 animate-pulse rounded-lg bg-surface-3/40" />}
      </div>
    </div>
  );
}
