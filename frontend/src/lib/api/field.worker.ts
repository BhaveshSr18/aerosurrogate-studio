/// <reference lib="webworker" />
import { fieldMock, NEAR_WINDOW, WAKE_WINDOW } from "../physics/mock-model";
import type { Design } from "../types";

self.onmessage = (e: MessageEvent<{ id: number; design: Design; window: "near" | "wake" }>) => {
  const { id, design, window } = e.data;
  const field = fieldMock(design, window === "wake" ? WAKE_WINDOW : NEAR_WINDOW);
  const buffers = [...Object.values(field.vars), field.u, field.v].map((a) => a.buffer);
  (self as unknown as Worker).postMessage({ id, field }, buffers);
};
