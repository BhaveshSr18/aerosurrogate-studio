import { Boxes, BrainCircuit, Calculator, ChevronRight, RefreshCw, Shapes } from "lucide-react";

const STEPS = [
  { icon: Shapes, title: "Parameterize", body: "NACA 4- or 5-digit parameters, angle of attack and inflow speed define a design." },
  { icon: Boxes, title: "Morph a mesh", body: "The nearest AirfRANS training mesh (~180k cells) is morphed onto the new shape and quality-checked." },
  { icon: BrainCircuit, title: "Predict the flow", body: "A MeshGraphNet passes messages across the mesh graph and predicts Ux, Uy, p and νt at every node." },
  { icon: Calculator, title: "Integrate forces", body: "Surface pressure and wall shear integrate to Cl, Cd and Cm, with ensemble uncertainty." },
  { icon: RefreshCw, title: "Optimize", body: "Evolutionary search calls the surrogate thousands of times to find better shapes." },
];

export function Pipeline({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`grid gap-3 ${compact ? "md:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-5"}`}>
      {STEPS.map((s, i) => (
        <li key={s.title} className="relative rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <s.icon className="h-4 w-4" />
            </span>
            <span className="tabular font-mono text-[11px] text-muted">0{i + 1}</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{s.body}</p>
          {i < STEPS.length - 1 && (
            <ChevronRight className="absolute top-1/2 -right-3 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full border border-border bg-bg p-0.5 text-muted lg:block" />
          )}
        </li>
      ))}
    </ol>
  );
}
