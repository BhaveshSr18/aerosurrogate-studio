export const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

/** Drag counts (1 count = 0.0001). */
export const counts = (cd: number) => `${Math.round(cd * 1e4)}`;

export function fmtRe(re: number) {
  const exp = Math.floor(Math.log10(re));
  return `${(re / 10 ** exp).toFixed(2)} × 10${sup(exp)}`;
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
const sup = (n: number) => String(n).split("").map((c) => SUP[c]).join("");

export const signed = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
