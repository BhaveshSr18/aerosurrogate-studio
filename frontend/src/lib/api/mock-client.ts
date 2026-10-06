import type { SurrogateClient } from "./client";
import type { Design, FieldData, OptimizationResult } from "../types";
import { DEFAULT_ENVELOPE } from "../physics/envelope";
import { fieldMock, MOCK_MODEL_VERSION, NEAR_WINDOW, predictMock, sweepMock, WAKE_WINDOW } from "../physics/mock-model";
import { sleep } from "../utils";

/** Simulated network + inference latency so loading states are exercised realistically. */
const LATENCY_MS = 220;

let fieldWorker: Worker | null = null;
let nextId = 1;
let inflight = false;
let queued: FieldRequest | null = null;
const pending = new Map<number, { resolve: (f: FieldData) => void; reject: (e: unknown) => void }>();

interface FieldRequest {
  id: number;
  design: Design;
  window: "near" | "wake";
}

function send(req: FieldRequest) {
  inflight = true;
  fieldWorker!.postMessage(req);
}

function getFieldWorker() {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!fieldWorker) {
    fieldWorker = new Worker(new URL("./field.worker.ts", import.meta.url));
    fieldWorker.onmessage = (e: MessageEvent<{ id: number; field: FieldData }>) => {
      pending.get(e.data.id)?.resolve(e.data.field);
      pending.delete(e.data.id);
      inflight = false;
      // Only the newest queued request survives; intermediate slider positions are skipped.
      if (queued) {
        const q = queued;
        queued = null;
        send(q);
      }
    };
    // A crashed worker must not leave callers waiting forever: fail everything in flight and
    // start a fresh worker on the next request.
    fieldWorker.onerror = (e) => {
      e.preventDefault();
      const err = new Error(`Field computation failed: ${e.message || "worker error"}`);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      queued = null;
      inflight = false;
      fieldWorker?.terminate();
      fieldWorker = null;
    };
  }
  return fieldWorker;
}

export const mockClient: SurrogateClient = {
  async model() {
    return { mode: "mock", name: "Panel-method placeholder", version: MOCK_MODEL_VERSION, status: "placeholder" };
  },

  async envelope() {
    return DEFAULT_ENVELOPE;
  },

  async predict(design, opts) {
    await sleep(LATENCY_MS, opts?.signal);
    return predictMock(design);
  },

  async field(design, window, signal) {
    const w = getFieldWorker();
    if (!w) return fieldMock(design, window === "wake" ? WAKE_WINDOW : NEAR_WINDOW);
    const id = nextId++;
    return new Promise<FieldData>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => {
        pending.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      });
      const req = { id, design, window };
      if (!inflight) send(req);
      else {
        // Only the newest request is kept; the superseded caller is told so instead of hanging.
        if (queued) {
          pending.get(queued.id)?.reject(new DOMException("Superseded", "AbortError"));
          pending.delete(queued.id);
        }
        queued = req;
      }
    });
  },

  async sweep(req, signal) {
    await sleep(LATENCY_MS, signal);
    const aoas: number[] = [];
    for (let a = req.aoaStart; a <= req.aoaEnd + 1e-9; a += req.aoaStep) aoas.push(Number(a.toFixed(4)));
    return sweepMock(req.design, aoas);
  },

  optimize(cfg, onProgress, signal) {
    return new Promise<OptimizationResult>((resolve, reject) => {
      const worker = new Worker(new URL("./optimizer.worker.ts", import.meta.url));
      signal?.addEventListener("abort", () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      });
      worker.onmessage = (e) => {
        if (e.data.type === "progress") onProgress(e.data.update);
        else {
          worker.terminate();
          resolve(e.data.result);
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      worker.postMessage(cfg);
    });
  },
};
