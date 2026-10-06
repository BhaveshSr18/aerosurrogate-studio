/**
 * Field colormaps built from the data-viz reference palette:
 *   sequential = one hue (blue ramp), light->dark on light surfaces, dark->light on dark;
 *   diverging  = blue <-> red with a neutral gray midpoint (never a hue at the midpoint).
 */
import type { FieldVar } from "./types";

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"].map(hex);
const RED = ["#fbd9d6", "#f6b9b4", "#f09690", "#e97370", "#e34948", "#c93a3a", "#a82e2e", "#852222"].map(hex);

function build(stops: RGB[], n = 256): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
  }
  return out;
}

export type Theme = "light" | "dark";

export function sequential(theme: Theme) {
  // Low values recede toward the surface in both themes.
  return theme === "light" ? build([hex("#f4f8fe"), ...BLUE]) : build([hex("#172231"), ...BLUE.slice().reverse()]);
}

export function diverging(theme: Theme) {
  const mid = hex(theme === "light" ? "#f0efec" : "#383835");
  const blueArm = [BLUE[12], BLUE[10], BLUE[8], BLUE[6], BLUE[4], BLUE[2]];
  const redArm = [RED[0], RED[2], RED[4], RED[5], RED[6], RED[7]];
  return build([...blueArm, mid, ...redArm]);
}

export function colormapToCss(lut: Uint8ClampedArray, n = 12) {
  const stops: string[] = [];
  const size = lut.length / 3;
  for (let i = 0; i < n; i++) {
    const k = Math.round((i / (n - 1)) * (size - 1));
    stops.push(`rgb(${lut[k * 3]},${lut[k * 3 + 1]},${lut[k * 3 + 2]}) ${((i / (n - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export interface FieldVarMeta {
  key: FieldVar;
  label: string;
  short: string;
  unit: string;
  kind: "sequential" | "diverging";
  /** Diverging center (value mapped to the neutral midpoint). */
  center?: number;
  /** Optional fixed range; otherwise robust percentiles of the data. */
  range?: [number, number];
  digits: number;
}

export const FIELD_VARS: FieldVarMeta[] = [
  { key: "cp", label: "Pressure coefficient", short: "Cp", unit: "", kind: "diverging", center: 0, digits: 2 },
  { key: "umag", label: "Velocity magnitude", short: "|U|/U∞", unit: "", kind: "sequential", range: [0, 1.6], digits: 2 },
  { key: "ux", label: "Streamwise velocity", short: "Ux", unit: "m/s", kind: "sequential", digits: 1 },
  { key: "uy", label: "Vertical velocity", short: "Uy", unit: "m/s", kind: "diverging", center: 0, digits: 1 },
  { key: "nut", label: "Turbulent viscosity ratio", short: "νt/ν", unit: "", kind: "sequential", digits: 0 },
];

/** Robust range from the 1st/99th percentiles, ignoring NaN (the airfoil interior). */
export function robustRange(data: Float32Array, meta: FieldVarMeta): [number, number] {
  if (meta.range) return meta.range;
  const vals: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 20000));
  for (let i = 0; i < data.length; i += stride) if (Number.isFinite(data[i])) vals.push(data[i]);
  vals.sort((a, b) => a - b);
  let lo = vals[Math.floor(vals.length * 0.01)] ?? 0;
  let hi = vals[Math.floor(vals.length * 0.99)] ?? 1;
  if (meta.kind === "diverging") {
    const c = meta.center ?? 0;
    const r = Math.max(Math.abs(lo - c), Math.abs(hi - c)) || 1;
    lo = c - r;
    hi = c + r;
  }
  if (meta.key === "nut") lo = 0;
  return [lo, hi];
}
