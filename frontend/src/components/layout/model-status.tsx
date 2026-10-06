"use client";

import { API_MODE } from "@/lib/api/client";
import { Tooltip } from "@/components/ui/tooltip";

export function ModelStatusBadge() {
  const mock = API_MODE === "mock";
  return (
    <Tooltip
      side="bottom"
      content={
        mock ? (
          <>
            <div className="mb-1 font-semibold text-fg">Preview mode · placeholder physics</div>
            Results come from an in-browser panel method with empirical viscous corrections, calibrated against
            AirfRANS k-ω SST cases. The MeshGraphNet surrogate plugs in through the same API once its training run is
            finished.
          </>
        ) : (
          "Connected to the MeshGraphNet surrogate service."
        )
      }
    >
      <button className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-2 sm:flex">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${mock ? "bg-warning" : "bg-good"}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${mock ? "bg-warning" : "bg-good"}`} />
        </span>
        {mock ? "Preview · mock model" : "Live surrogate"}
      </button>
    </Tooltip>
  );
}
