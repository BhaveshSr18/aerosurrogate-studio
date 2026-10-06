/**
 * Domain types shared by the UI and the API client. They mirror the planned FastAPI
 * contract (see README "Backend contract") so swapping the mock for the real surrogate
 * backend does not touch any component.
 */

export type NacaFamily = "4" | "5";

/** NACA 4-digit parameters, in AirfRANS case-name units (continuous, not integer digits). */
export interface Naca4Params {
  /** Maximum camber, % chord */
  M: number;
  /** Position of maximum camber, tenths of chord */
  P: number;
  /** Maximum thickness, % chord */
  T: number;
}

/** NACA 5-digit parameters, in AirfRANS case-name units. */
export interface Naca5Params {
  /** Design-lift parameter (design Cl = 0.15 L) */
  L: number;
  /** Position of maximum camber, twentieths of chord */
  P: number;
  /** Reflex flag: 0 = standard, 1 = reflexed camber line */
  Q: 0 | 1;
  /** Maximum thickness, % chord */
  T: number;
}

export interface Design {
  family: NacaFamily;
  naca4: Naca4Params;
  naca5: Naca5Params;
  /** Angle of attack, degrees (applied through the inflow direction, as in AirfRANS) */
  aoa: number;
  /** Freestream speed, m/s */
  speed: number;
}

export type Point = [number, number];

export interface AirfoilGeometry {
  upper: Point[];
  lower: Point[];
  camber: Point[];
  /** Closed polygon TE -> lower -> LE -> upper -> TE (clockwise), for panel codes. */
  loop: Point[];
  maxThickness: { x: number; t: number };
  maxCamber: { x: number; c: number };
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface EnvelopeCheck {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  status: CheckStatus;
  message?: string;
}

export interface MeshMorphInfo {
  /** AirfRANS case whose mesh was morphed onto the design (placeholder in mock mode). */
  baseCase: string;
  /** Distance to the base shape in canonical NACA space. */
  shapeDistance: number;
  maxSurfaceDisplacement: number;
  minCellQuality: number;
  nodes: number;
  status: CheckStatus;
}

export interface Uncertainty {
  cl: number;
  cd: number;
  ld: number;
}

export interface SurfaceDistribution {
  x: number[];
  cpUpper: number[];
  cpLower: number[];
}

export interface Prediction {
  id: string;
  design: Design;
  reynolds: number;
  mach: number;
  cl: number;
  cd: number;
  cm: number;
  ld: number;
  clPressure: number;
  clViscous: number;
  cdPressure: number;
  cdViscous: number;
  uncertainty: Uncertainty;
  envelope: EnvelopeCheck[];
  mesh: MeshMorphInfo;
  surface: SurfaceDistribution;
  stalled: boolean;
  timingMs: number;
  modelVersion: string;
}

export type FieldVar = "cp" | "umag" | "ux" | "uy" | "nut";

export interface FieldData {
  nx: number;
  ny: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  /** Row-major (j * nx + i), NaN inside the airfoil. */
  vars: Record<FieldVar, Float32Array>;
  /** Velocity normalized by U_inf, for streamlines/particles. */
  u: Float32Array;
  v: Float32Array;
  speed: number;
}

export interface PolarPoint {
  aoa: number;
  cl: number;
  cd: number;
  cm: number;
  ld: number;
  clSigma: number;
  cdSigma: number;
  stalled: boolean;
}

export interface SweepRequest {
  design: Design;
  aoaStart: number;
  aoaEnd: number;
  aoaStep: number;
}

export interface EnvelopeRange {
  min: number;
  max: number;
  step: number;
}

export interface Envelope {
  naca4: Record<keyof Naca4Params, EnvelopeRange>;
  naca5: Record<"L" | "P" | "T", EnvelopeRange>;
  aoa: EnvelopeRange;
  speed: EnvelopeRange;
  /** true while these are placeholders rather than the training-set ranges from the backend */
  provisional: boolean;
}

export interface ModelInfo {
  mode: "mock" | "live";
  name: string;
  version: string;
  status: "placeholder" | "validated" | "unvalidated";
  checkpoint?: string;
}

/* ---------------- Optimization ---------------- */

export type ObjectiveKind = "max_ld" | "min_cd_at_cl" | "max_cl" | "robust_ld" | "pareto_ld_cl";
export type Algorithm = "ga" | "nsga2";

export interface VariableSpec {
  key: string;
  label: string;
  unit: string;
  enabled: boolean;
  min: number;
  max: number;
  /** Value used when the variable is not optimized. */
  fixed: number;
}

export interface OptimizationConfig {
  family: NacaFamily;
  objective: ObjectiveKind;
  targetCl: number;
  robustBand: number;
  uncertaintyPenalty: number;
  variables: VariableSpec[];
  speed: number;
  reflex: 0 | 1;
  constraints: {
    minThickness: number;
    maxAbsCm: number | null;
    stayInEnvelope: boolean;
  };
  algorithm: Algorithm;
  populationSize: number;
  generations: number;
  seed: number;
}

export interface Candidate {
  design: Design;
  /** Encoded design vector (enabled variables only). */
  x?: number[];
  cl: number;
  cd: number;
  cm: number;
  ld: number;
  /** Objective values in "minimize" form (lower is better). */
  objectives: number[];
  violation: number;
  feasible: boolean;
  rank?: number;
}

export interface GenerationUpdate {
  generation: number;
  evaluations: number;
  elapsedMs: number;
  best: Candidate;
  population: Candidate[];
  history: { generation: number; best: number; mean: number }[];
  pareto?: Candidate[];
}

export interface OptimizationResult extends GenerationUpdate {
  top: Candidate[];
  config: OptimizationConfig;
}
