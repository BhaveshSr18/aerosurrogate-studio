/**
 * Training envelope used for slider limits and "outside training data" warnings.
 *
 * PLACEHOLDER: these are the nominal AirfRANS sampling ranges. In live mode they are
 * replaced by GET /api/envelope, which reads the actual training-split ranges
 * (`input_ranges`) that compute_stats.py records in the stats metadata.
 */
import type { CheckStatus, Design, Envelope, EnvelopeCheck } from "../types";

export const NU_AIR = 1.5498e-5; // m^2/s, matches config.NU_MOLECULAR in the surrogate repo
export const CHORD = 1.0; // m
export const SOUND_SPEED = 346.1; // m/s at 298.15 K

export const DEFAULT_ENVELOPE: Envelope = {
  naca4: {
    M: { min: 0, max: 7, step: 0.1 },
    P: { min: 0, max: 7, step: 0.1 },
    T: { min: 5, max: 20, step: 0.1 },
  },
  naca5: {
    L: { min: 0, max: 4, step: 0.1 },
    P: { min: 3, max: 8, step: 0.1 },
    T: { min: 5, max: 20, step: 0.1 },
  },
  aoa: { min: -5, max: 15, step: 0.1 },
  speed: { min: 31, max: 94, step: 0.5 },
  provisional: true,
};

export const reynolds = (speed: number) => (speed * CHORD) / NU_AIR;
export const mach = (speed: number) => speed / SOUND_SPEED;

function check(key: string, label: string, value: number, min: number, max: number): EnvelopeCheck {
  const span = max - min;
  const margin = 0.03 * span;
  let status: CheckStatus = "pass";
  let message: string | undefined;
  if (value < min - 1e-9 || value > max + 1e-9) {
    status = "fail";
    message = "Outside the training range; the prediction is an extrapolation.";
  } else if (value < min + margin || value > max - margin) {
    status = "warn";
    message = "Near the edge of the training range; expect higher error.";
  }
  return { key, label, value, min, max, status, message };
}

export function envelopeChecks(d: Design, env: Envelope = DEFAULT_ENVELOPE): EnvelopeCheck[] {
  const out: EnvelopeCheck[] = [];
  if (d.family === "4") {
    out.push(check("M", "Max camber M", d.naca4.M, env.naca4.M.min, env.naca4.M.max));
    out.push(check("P", "Camber position P", d.naca4.P, env.naca4.P.min, env.naca4.P.max));
    out.push(check("T", "Thickness T", d.naca4.T, env.naca4.T.min, env.naca4.T.max));
  } else {
    out.push(check("L", "Design lift L", d.naca5.L, env.naca5.L.min, env.naca5.L.max));
    out.push(check("P", "Camber position P", d.naca5.P, env.naca5.P.min, env.naca5.P.max));
    out.push(check("T", "Thickness T", d.naca5.T, env.naca5.T.min, env.naca5.T.max));
  }
  out.push(check("aoa", "Angle of attack", d.aoa, env.aoa.min, env.aoa.max));
  out.push(check("speed", "Inflow speed", d.speed, env.speed.min, env.speed.max));
  return out;
}

/** 0 at the centre of the envelope, 1 at its boundary (max over dimensions). */
export function envelopeDistance(d: Design, env: Envelope = DEFAULT_ENVELOPE) {
  return Math.max(
    ...envelopeChecks(d, env).map((c) => Math.abs((c.value - (c.min + c.max) / 2) / ((c.max - c.min) / 2))),
  );
}
