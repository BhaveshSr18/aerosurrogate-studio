import Link from "next/link";
import { LogoMark } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-5" />
          <span>AeroSurrogate Studio · graph-neural-network CFD surrogate for airfoil design</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/model" className="hover:text-fg">Model card</Link>
          <a href="https://airfrans.readthedocs.io" target="_blank" rel="noreferrer" className="hover:text-fg">AirfRANS dataset</a>
          <a href="https://github.com/NVIDIA/physicsnemo" target="_blank" rel="noreferrer" className="hover:text-fg">NVIDIA PhysicsNeMo</a>
          {/* PLACEHOLDER: author links (GitHub, LinkedIn, paper) */}
          <span className="text-muted">Author links — coming soon</span>
        </div>
      </div>
    </footer>
  );
}
