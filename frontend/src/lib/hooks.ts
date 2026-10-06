"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type { Design, Envelope, FieldData, Prediction } from "./types";
import { DEFAULT_ENVELOPE } from "./physics/envelope";

export function useDebounced<T>(value: T, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useEnvelope() {
  const [env, setEnv] = useState<Envelope>(DEFAULT_ENVELOPE);
  useEffect(() => {
    api.envelope().then(setEnv).catch(() => {});
  }, []);
  return env;
}

/** Latest prediction for a design; keeps the previous result visible while loading. */
export function usePrediction(design: Design) {
  const debounced = useDebounced(design);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [prev, setPrev] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<Prediction | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api
      .predict(debounced, { signal: ctrl.signal })
      .then((p) => {
        setPrev(lastRef.current);
        lastRef.current = p;
        setPred(p);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [debounced]);

  return { pred, prev, loading, error };
}

export function useField(design: Design, window: "near" | "wake") {
  const debounced = useDebounced(design, 260);
  const [field, setField] = useState<FieldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api
      .field(debounced, window, ctrl.signal)
      .then((f) => {
        setField(f);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return; // superseded by a newer request
        setError(String(e?.message ?? e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, window]);
  return { field, loading, error };
}
