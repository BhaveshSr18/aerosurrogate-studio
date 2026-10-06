"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import { DEFAULT_DESIGN } from "@/lib/presets";

/** Route-level error boundary: keeps the header/footer and offers a recovery path. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="tabular font-mono text-sm text-muted">Error</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-muted">
        Try again. If the problem persists, reset the current design to the default, which clears any bad state stored in this browser.
      </p>
      {error.digest && <p className="tabular mt-2 font-mono text-[11px] text-muted">ref {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button
          variant="secondary"
          onClick={() => {
            useApp.getState().setDesign(DEFAULT_DESIGN);
            reset();
          }}
        >
          Reset design
        </Button>
        <Link href="/" className={buttonClass("ghost", "md")}>
          Home
        </Link>
      </div>
    </div>
  );
}
