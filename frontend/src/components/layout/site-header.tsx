"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { ModelStatusBadge } from "./model-status";
import { useApp } from "@/lib/store";

const NAV = [
  { href: "/studio", label: "Design Studio" },
  { href: "/polar", label: "Polars" },
  { href: "/optimize", label: "Optimizer" },
  { href: "/compare", label: "Compare" },
  { href: "/model", label: "Model" },
];

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {mounted ? dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" /> : <span className="h-4 w-4" />}
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const savedCount = useApp((s) => s.saved.length);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-sm font-semibold tracking-tight">
            AeroSurrogate <span className="text-muted">Studio</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                {n.label}
                {n.href === "/compare" && savedCount > 0 && (
                  <span className="tabular ml-1.5 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{savedCount}</span>
                )}
                {active && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ModelStatusBadge />
          <ThemeToggle />
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border bg-bg px-4 py-2 md:hidden" aria-label="Mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("block rounded-md px-3 py-2.5 text-sm", pathname.startsWith(n.href) ? "bg-surface-2 text-fg" : "text-fg-2")}>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
