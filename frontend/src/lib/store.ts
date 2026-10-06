"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Design, OptimizationResult } from "./types";
import { DEFAULT_DESIGN } from "./presets";
import { designation } from "./physics/naca";
import { sanitizeDesign } from "./share";

export interface SavedDesign {
  id: string;
  name: string;
  design: Design;
  savedAt: number;
}

export const MAX_COMPARE = 4;

interface AppState {
  design: Design;
  setDesign: (d: Design | ((d: Design) => Design)) => void;
  saved: SavedDesign[];
  saveDesign: (d: Design, name?: string) => { ok: boolean; reason?: string };
  removeSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  lastOptimization: OptimizationResult | null;
  setLastOptimization: (r: OptimizationResult | null) => void;
  bannerDismissed: boolean;
  dismissBanner: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      design: DEFAULT_DESIGN,
      setDesign: (d) => set((s) => ({ design: typeof d === "function" ? d(s.design) : d })),
      saved: [],
      saveDesign: (d, name) => {
        if (get().saved.length >= MAX_COMPARE) return { ok: false, reason: `Compare holds up to ${MAX_COMPARE} designs. Remove one first.` };
        const item: SavedDesign = {
          id: Math.random().toString(36).slice(2, 10),
          name: name ?? `${designation(d).replace("≈ ", "")} @ ${d.aoa.toFixed(1)}°`,
          design: structuredClone(d),
          savedAt: Date.now(),
        };
        set((s) => ({ saved: [...s.saved, item] }));
        return { ok: true };
      },
      removeSaved: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
      renameSaved: (id, name) => set((s) => ({ saved: s.saved.map((x) => (x.id === id ? { ...x, name } : x)) })),
      lastOptimization: null,
      setLastOptimization: (r) => set({ lastOptimization: r }),
      bannerDismissed: false,
      dismissBanner: () => set({ bannerDismissed: true }),
    }),
    {
      name: "aerosurrogate-studio",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ design: s.design, saved: s.saved, bannerDismissed: s.bannerDismissed }),
      // Persisted state may come from an older build or a hand-edited link: never restore NaN or
      // out-of-range designs, which would break the geometry and every downstream chart.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          design: sanitizeDesign(p.design),
          saved: Array.isArray(p.saved) ? p.saved.slice(0, MAX_COMPARE).map((s) => ({ ...s, design: sanitizeDesign(s.design) })) : [],
        };
      },
    },
  ),
);

/** True once persisted state has been restored (after mount). */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useApp.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useApp.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}
