"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { API_MODE } from "@/lib/api/client";

export function DemoBanner() {
  const dismissed = useApp((s) => s.bannerDismissed);
  const dismiss = useApp((s) => s.dismissBanner);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || dismissed || API_MODE !== "mock") return null;
  return (
    <aside aria-label="Preview notice" className="border-b border-warning/25 bg-warning/10 text-xs text-fg-2">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2 sm:px-6">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="flex-1">
          <span className="font-medium text-fg">Preview build.</span> Numbers and fields come from a placeholder model (panel method with
          viscous corrections calibrated on AirfRANS RANS cases), not the trained MeshGraphNet surrogate.{" "}
          <Link href="/model" className="font-medium text-accent hover:underline">
            What&apos;s pending →
          </Link>
        </p>
        <button onClick={dismiss} className="text-muted hover:text-fg" aria-label="Dismiss notice">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}
