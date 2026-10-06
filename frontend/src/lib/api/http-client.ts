/**
 * Live client for the FastAPI surrogate service (backend/aerostudio/api/app.py).
 * Enable with NEXT_PUBLIC_API_MODE=live.
 *
 *   GET    /api/health                -> ModelInfo
 *   GET    /api/envelope              -> Envelope (training-split input ranges)
 *   POST   /api/predict               -> Prediction
 *   POST   /api/field                 -> field grid (JSON, NaN as null), cached with /api/predict
 *   POST   /api/sweep                 -> PolarPoint[]
 *   POST   /api/optimize              -> { jobId }
 *   GET    /api/jobs/{jobId}/stream   -> SSE: progress*, then done | error | cancelled
 *   DELETE /api/jobs/{jobId}          -> cancel
 */
import type { SurrogateClient } from "./client";
import type { FieldData, FieldVar, GenerationUpdate, OptimizationResult } from "../types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {}
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<T>;
}

type Grid = (number | null)[];
interface FieldWire extends Omit<FieldData, "vars" | "u" | "v"> {
  vars: Record<FieldVar, Grid>;
  u: Grid;
  v: Grid;
}

const toF32 = (a: Grid) => Float32Array.from(a, (v) => (v == null ? NaN : v));

function decodeField(w: FieldWire): FieldData {
  const vars = Object.fromEntries(Object.entries(w.vars).map(([k, a]) => [k, toF32(a)])) as Record<FieldVar, Float32Array>;
  return { ...w, vars, u: toF32(w.u), v: toF32(w.v) };
}

export const httpClient: SurrogateClient = {
  async model() {
    const info = await json<{ mode: "live"; name: string; version: string; status: string; checkpoint?: string }>("/api/health");
    return { ...info, status: info.status === "validated" ? "validated" : info.status === "placeholder" ? "placeholder" : "unvalidated" };
  },
  envelope: () => json("/api/envelope"),
  predict: (design, opts) =>
    json("/api/predict", { method: "POST", body: JSON.stringify({ design, ensemble: opts?.ensemble ?? true }), signal: opts?.signal }),
  async field(design, window, signal) {
    return decodeField(await json<FieldWire>("/api/field", { method: "POST", body: JSON.stringify({ design, window }), signal }));
  },
  sweep: (req, signal) => json("/api/sweep", { method: "POST", body: JSON.stringify(req), signal }),
  async optimize(cfg, onProgress, signal) {
    const { jobId } = await json<{ jobId: string }>("/api/optimize", { method: "POST", body: JSON.stringify(cfg), signal });
    return new Promise<OptimizationResult>((resolve, reject) => {
      const es = new EventSource(`${BASE}/api/jobs/${jobId}/stream`);
      const close = () => es.close();
      signal?.addEventListener("abort", () => {
        close();
        fetch(`${BASE}/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
        reject(new DOMException("Aborted", "AbortError"));
      });
      es.addEventListener("progress", (e) => onProgress(JSON.parse((e as MessageEvent).data) as GenerationUpdate));
      es.addEventListener("done", (e) => {
        close();
        resolve(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener("error", (e) => {
        // Server-sent "error" events carry data; transport errors do not.
        const data = (e as MessageEvent).data;
        close();
        reject(new Error(data ? JSON.parse(data).message : "Optimization stream disconnected"));
      });
      es.addEventListener("cancelled", () => {
        close();
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  },
};
