"use client";

import * as React from "react";
import { create } from "zustand";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), 4200);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = (title: string, description?: string, tone: Tone = "info") => useToasts.getState().push({ title, description, tone });

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {items.map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "warning" ? AlertTriangle : Info;
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-card">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.tone === "success" ? "text-good" : t.tone === "warning" ? "text-warning" : "text-accent")} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{t.title}</div>
              {t.description && <div className="mt-0.5 text-xs text-fg-2">{t.description}</div>}
            </div>
            <button onClick={() => remove(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
