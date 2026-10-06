import Link from "next/link";
import { ArrowRight, Gauge, GitCompareArrows, LineChart, PencilRuler, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { HeroFlow } from "@/components/viz/hero-flow";
import { Pipeline } from "@/components/landing/pipeline";

const STATS = [
  { value: "1,000", label: "RANS simulations in the AirfRANS training corpus" },
  { value: "~180k", label: "mesh nodes per case, predicted in a single pass" },
  { value: "4", label: "flow fields per prediction: Ux, Uy, p and νt" },
  { value: "15", label: "message-passing layers in the MeshGraphNet processor" },
];

const FEATURES = [
  { icon: PencilRuler, title: "Design Studio", body: "Drag NACA parameters and see pressure, velocity and turbulence fields update, with Cl, Cd and L/D.", href: "/studio" },
  { icon: LineChart, title: "Polar analysis", body: "Lift curves, drag polars, L/D and pitching moment across angle of attack, overlaid for several designs.", href: "/polar" },
  { icon: Sparkles, title: "Optimizer", body: "Genetic algorithm and NSGA-II over the design space, with constraints and live convergence.", href: "/optimize" },
  { icon: GitCompareArrows, title: "Compare", body: "Up to four designs side by side: shapes, Cp distributions and coefficient deltas.", href: "/compare" },
  { icon: ShieldCheck, title: "Trust signals", body: "Ensemble uncertainty, training-envelope checks and mesh-quality reports on every prediction.", href: "/model" },
  { icon: Waves, title: "Full-field output", body: "Not just coefficients: the whole flow field, to see where separation and suction peaks happen.", href: "/studio" },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid max-w-[1400px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Graph neural network CFD surrogate
            </div>
            <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Airfoil design at the speed of <span className="text-accent">inference</span>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-pretty text-fg-2 sm:text-lg">
              AeroSurrogate Studio replaces hours of RANS simulation with a MeshGraphNet surrogate trained on AirfRANS. Shape an airfoil, read the
              full flow field and aerodynamic coefficients right away, then let an optimizer search thousands of designs.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/studio" className={buttonClass("primary", "lg")}>
                Open Design Studio <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/optimize" className={buttonClass("outline", "lg")}>
                <Sparkles className="h-4 w-4" /> Run an optimization
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
              <span>Built on</span>
              <span className="font-medium text-fg-2">AirfRANS</span>
              <span className="font-medium text-fg-2">NVIDIA PhysicsNeMo</span>
              <span className="font-medium text-fg-2">PyTorch Geometric</span>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
                  <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
                  <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
                </div>
                <span className="tabular font-mono text-[11px] text-muted">NACA 4412 · α 6° · U∞ 50 m/s</span>
                <span className="text-[11px] text-muted">Cp field</span>
              </div>
              <HeroFlow className="w-full" />
            </div>
            <div className="absolute -bottom-5 left-4 hidden gap-2 sm:flex">
              {[
                ["Fields", "Ux · Uy · p · νt"],
                ["Mesh", "~180k nodes"],
                ["Output", "Cl · Cd · Cm ± σ"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-card backdrop-blur">
                  <div className="text-[10px] text-muted">{k}</div>
                  <div className="tabular font-mono text-xs font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-px bg-border lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-bg px-6 py-8">
              <div className="text-3xl font-semibold tracking-tight">{s.value}</div>
              <div className="mt-1.5 max-w-[220px] text-xs leading-relaxed text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold tracking-wider text-accent uppercase">How it works</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">From five numbers to a full RANS flow field</h2>
          <p className="mt-3 text-fg-2">
            The surrogate learned the mapping from mesh geometry and inflow to the converged k-ω SST solution. For a new design it needs only a
            mesh, and one comes from morphing the closest training case.
          </p>
        </div>
        <div className="mt-10">
          <Pipeline />
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-surface-2/50">
        <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold tracking-wider text-accent uppercase">Capabilities</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">A complete aerodynamic design loop</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Link
                key={f.title}
                href={f.href}
                className="group rounded-xl border border-border bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <f.icon className="h-4.5 w-4.5" />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  Open <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Honest by design */}
      <section className="mx-auto grid max-w-[1400px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold tracking-wider text-accent uppercase">Honest by design</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">A surrogate that tells you when not to trust it</h2>
          <p className="mt-3 text-fg-2">
            Learned models are fast but can be confidently wrong outside their training data. Every prediction here carries the signals an engineer
            needs to judge it.
          </p>
        </div>
        <ul className="space-y-3">
          {[
            ["Ensemble uncertainty", "Several independently trained models; their spread becomes the ±σ on each coefficient, and optimization can penalize it."],
            ["Training-envelope checks", "Each input is checked against the training distribution, with explicit warnings when a prediction extrapolates."],
            ["Mesh-quality gate", "Morphed meshes are checked for inverted cells and near-wall resolution before inference."],
            ["Physics constraints", "No-slip is enforced exactly at the wall; physics-residual diagnostics accompany each prediction."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3 rounded-xl border border-border bg-surface p-4">
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-0.5 text-sm text-muted">{d}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-8 py-12 text-center shadow-card">
          <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Start designing</h2>
            <p className="mx-auto mt-2 max-w-lg text-fg-2">Pick a classic NACA section, or start from scratch.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/studio" className={buttonClass("primary", "lg")}>
                Open Design Studio <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/model" className={buttonClass("secondary", "lg")}>
                Read the model card
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
