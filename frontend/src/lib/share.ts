import type { Design, EnvelopeRange } from "./types";
import { DEFAULT_DESIGN } from "./presets";
import { DEFAULT_ENVELOPE } from "./physics/envelope";
import { clamp } from "./utils";
import { snapCamberPosition } from "./physics/naca";

export function designToQuery(d: Design) {
  const q = new URLSearchParams({ f: d.family, a: String(d.aoa), u: String(d.speed) });
  if (d.family === "4") {
    q.set("m", String(d.naca4.M));
    q.set("p", String(d.naca4.P));
    q.set("t", String(d.naca4.T));
  } else {
    q.set("l", String(d.naca5.L));
    q.set("p", String(d.naca5.P));
    q.set("q", String(d.naca5.Q));
    q.set("t", String(d.naca5.T));
  }
  return q.toString();
}

/** Clamps every parameter of a (possibly stale or hand-edited) design to the slider ranges. */
export function sanitizeDesign(d: Partial<Design> | null | undefined, fallback: Design = DEFAULT_DESIGN): Design {
  const env = DEFAULT_ENVELOPE;
  const v = (x: unknown, dflt: number, r: EnvelopeRange) => clamp(typeof x === "number" && Number.isFinite(x) ? x : dflt, r.min, r.max);
  const n4 = d?.naca4 ?? fallback.naca4;
  const n5 = d?.naca5 ?? fallback.naca5;
  return {
    family: d?.family === "5" ? "5" : "4",
    naca4: {
      M: v(n4.M, fallback.naca4.M, env.naca4.M),
      P: snapCamberPosition(v(n4.P, fallback.naca4.P, env.naca4.P)),
      T: v(n4.T, fallback.naca4.T, env.naca4.T),
    },
    naca5: {
      L: v(n5.L, fallback.naca5.L, env.naca5.L),
      P: v(n5.P, fallback.naca5.P, env.naca5.P),
      Q: n5.Q === 1 ? 1 : 0,
      T: v(n5.T, fallback.naca5.T, env.naca5.T),
    },
    aoa: v(d?.aoa, fallback.aoa, env.aoa),
    speed: v(d?.speed, fallback.speed, env.speed),
  };
}

/**
 * Parses a shared design. Every value is clamped to the slider ranges (the same limits the
 * controls enforce), so a hand-edited or truncated link can never produce a degenerate
 * geometry (zero thickness, negative speed) or NaN coefficients.
 */
export function designFromQuery(search: string, fallback: Design = DEFAULT_DESIGN): Design | null {
  const q = new URLSearchParams(search);
  if (!q.has("f")) return null;
  const n = (k: string, dflt: number, r: EnvelopeRange) => {
    const raw = q.get(k);
    const v = raw == null || raw.trim() === "" ? NaN : Number(raw);
    return clamp(Number.isFinite(v) ? v : dflt, r.min, r.max);
  };
  const env = DEFAULT_ENVELOPE;
  const family = q.get("f") === "5" ? "5" : "4";
  return {
    family,
    naca4:
      family === "4" ? { M: n("m", 2, env.naca4.M), P: snapCamberPosition(n("p", 4, env.naca4.P)), T: n("t", 12, env.naca4.T) } : fallback.naca4,
    naca5:
      family === "5"
        ? { L: n("l", 2, env.naca5.L), P: n("p", 3, env.naca5.P), Q: q.get("q") === "1" ? 1 : 0, T: n("t", 12, env.naca5.T) }
        : fallback.naca5,
    aoa: n("a", fallback.aoa, env.aoa),
    speed: n("u", fallback.speed, env.speed),
  };
}
