import type {
  Design,
  Envelope,
  FieldData,
  GenerationUpdate,
  ModelInfo,
  OptimizationConfig,
  OptimizationResult,
  PolarPoint,
  Prediction,
  SweepRequest,
} from "../types";
import { mockClient } from "./mock-client";
import { httpClient } from "./http-client";

/**
 * One interface, two implementations:
 *   mock  -> in-browser placeholder physics (default until the surrogate backend exists)
 *   live  -> FastAPI surrogate service (roadmap Phase 2)
 * Components only ever talk to `api`.
 */
export interface SurrogateClient {
  model(): Promise<ModelInfo>;
  envelope(): Promise<Envelope>;
  predict(design: Design, opts?: { ensemble?: boolean; signal?: AbortSignal }): Promise<Prediction>;
  field(design: Design, window: "near" | "wake", signal?: AbortSignal): Promise<FieldData>;
  sweep(req: SweepRequest, signal?: AbortSignal): Promise<PolarPoint[]>;
  optimize(
    cfg: OptimizationConfig,
    onProgress: (u: GenerationUpdate) => void,
    signal?: AbortSignal,
  ): Promise<OptimizationResult>;
}

export const API_MODE: "mock" | "live" = process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

export const api: SurrogateClient = API_MODE === "live" ? httpClient : mockClient;
