import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Pipeline } from "@/components/landing/pipeline";

export const metadata: Metadata = { title: "Model card" };

/* Facts below come from the surrogate repository (AirfransProject_migration). Metrics are
 * the acceptance targets in acceptance_criteria.json; measured values arrive after training. */

const ARCH: [string, string][] = [
  ["Architecture", "MeshGraphNet (encode → process → decode), NVIDIA PhysicsNeMo 2.0"],
  ["Processor", "15 message-passing layers · hidden width 128 · ReLU · sum aggregation"],
  ["Parameters", "≈ 2.55 M (base variant)"],
  ["Node inputs (14)", "x, y, signed distance, wall flag, wall normal (2), inflow U∞ (2), canonical NACA (4), 5-digit flag, log wall distance"],
  ["Edge inputs (6)", "dx, dy, |d|, unit direction (2), log |d|"],
  ["Outputs (4)", "Ux, Uy, kinematic pressure p/ρ, turbulent viscosity νt at every node"],
  ["Normalization", "Per-case physical scaling by U∞ (p by ½U∞², νt by U∞c), then z-scoring with training-split statistics"],
  ["Hard constraints", "No-slip enforced exactly on the wall (u = v = νt = 0)"],
  ["Uncertainty", "Deep ensemble: the spread across independently seeded members"],
];

const DATA: [string, string][] = [
  ["Dataset", "AirfRANS: 2D incompressible steady RANS, k-ω SST, OpenFOAM"],
  ["Geometries", "NACA 4- and 5-digit airfoils"],
  ["Split", "Official full task: 720 train / 80 validation / 200 test"],
  ["Mesh size", "~180k nodes, ~700k edges per case"],
  ["Reynolds", "≈ 2 – 6 × 10⁶ (U∞ ≈ 31 – 94 m/s, c = 1 m)"],
  ["Angle of attack", "≈ −5° to 15°"],
];

const TRAINING: [string, string][] = [
  ["Optimizer", "AdamW, lr 1e-4, weight decay 1e-4, gradient clip 1.0"],
  ["Schedule", "ReduceLROnPlateau (×0.7, patience 8), early stopping patience 20, ≤ 200 epochs"],
  ["Batch", "One full mesh per step, bf16 mixed precision"],
  ["Loss", "MSE on normalized fields; optional physics-residual fine-tune (λ = 1e-4)"],
  ["Hardware", "Azure NC A100 80 GB (planned full run)"],
];

const TARGETS = [
  { metric: "Relative L2 · Ux", target: "≤ 0.05" },
  { metric: "Relative L2 · Uy", target: "≤ 0.20" },
  { metric: "Relative L2 · p", target: "≤ 0.20" },
  { metric: "Relative L2 · νt", target: "≤ 0.50" },
  { metric: "R² · Ux / Uy / p / νt", target: "≥ 0.98 / 0.95 / 0.95 / 0.80" },
  { metric: "Spearman ρ · Cl", target: "≥ 0.98" },
  { metric: "Spearman ρ · Cd", target: "≥ 0.80" },
  { metric: "MAE · Cl", target: "≤ 0.05" },
];

/* Placeholder-physics calibration: the mock model vs the k-omega SST ground truth of the ten
 * AirfRANS base-mesh cases (backend/data/base_meshes; U ~ 31 m/s, Re ~ 2e6, -4 to 14 deg). */
const CALIBRATION: [string, string][] = [
  ["Cl", "mean absolute error 0.016"],
  ["Cd", "mean absolute error 1.2 %"],
  ["Cm¼", "mean absolute error 0.0045"],
  ["Surface Cp", "RMS error 0.047"],
  ["Wake", "centreline velocity deficit within 5 % on average (worst 24 %), νt/ν within 8 % (worst 25 %), at 0.05 c, 0.25 c and 0.5 c behind the trailing edge"],
  ["Cross-checks", "NACA 0012 at Re 6 × 10⁶: Cd₀ 0.0077 (NASA TMR SST 0.0081), dCl/dα 0.105 /°; Cm of NACA 2412 / 4412 within 0.005 of wind-tunnel data"],
];

const ROADMAP: { phase: string; title: string; status: "done" | "active" | "todo" }[] = [
  { phase: "0", title: "Full training run on A100 + inference benchmark", status: "todo" },
  { phase: "1", title: "Mesh-morphing engine for new geometries", status: "done" },
  { phase: "2", title: "FastAPI surrogate service", status: "done" },
  { phase: "3", title: "Server-side optimizer (pymoo) with job queue", status: "active" },
  { phase: "4", title: "Web interface (this preview)", status: "active" },
  { phase: "5", title: "Cloud deployment, CI, monitoring", status: "active" },
  { phase: "6", title: "Validation study against held-out CFD", status: "todo" },
];

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr] sm:gap-4">
          <dt className="text-xs font-medium text-muted">{k}</dt>
          <dd className="text-sm text-fg-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ModelPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-wider text-accent uppercase">Model card</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">MeshGraphNet surrogate for AirfRANS</h1>
          <p className="mt-2 max-w-2xl text-fg-2">
            What the model is, what it was trained on, how it will be judged, and where it should not be trusted.
          </p>
        </div>
        <Badge tone="warning" className="mt-2">
          <Clock className="h-3 w-3" /> Awaiting full training run
        </Badge>
      </div>

      <div className="mt-8 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-fg-2">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <span className="font-medium text-fg">This site currently runs in preview mode.</span> All numbers and fields come from an in-browser
            placeholder: an inviscid panel method with empirical viscous and stall corrections, calibrated so its numbers sit close to the AirfRANS
            RANS data (see <a href="#preview-physics" className="font-medium text-accent hover:underline">Preview physics</a>). The interface,
            API contract and workflows are final; the physics engine is swapped for the trained surrogate once the items below are complete.
          </div>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Inference pipeline</h2>
        <Pipeline compact />
      </section>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Architecture" />
          <CardBody>
            <KV rows={ARCH} />
          </CardBody>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Training data" />
            <CardBody>
              <KV rows={DATA} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Training setup" />
            <CardBody>
              <KV rows={TRAINING} />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Acceptance criteria" description="Test-split targets. Measured values are published after the full training run." />
          <CardBody>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-[11px] text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Metric</th>
                    <th className="px-3 py-2 text-right font-medium">Target</th>
                    <th className="px-3 py-2 text-right font-medium">Measured</th>
                  </tr>
                </thead>
                <tbody>
                  {TARGETS.map((t) => (
                    <tr key={t.metric} className="border-t border-border">
                      <td className="px-3 py-2 text-fg-2">{t.metric}</td>
                      <td className="tabular px-3 py-2 text-right font-mono text-xs text-fg">{t.target}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge>
                          <CircleDashed className="h-3 w-3" /> Pending
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Limitations" description="Where the surrogate should not be trusted" />
          <CardBody>
            <ul className="space-y-2.5 text-sm text-fg-2">
              {[
                "NACA 4- and 5-digit families only; other shapes are outside the training distribution.",
                "2D, incompressible, steady RANS (k-ω SST): no compressibility, transition or unsteady separation.",
                "Accuracy degrades past stall, where the steady RANS training data is itself less reliable.",
                "New shapes rely on a morphed mesh; heavily distorted morphs are rejected by the quality gate.",
                "Viscous drag depends on near-wall gradients and is harder to predict than lift.",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
                  {t}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5" id="preview-physics">
        <CardHeader
          title="Preview physics"
          description="How close the placeholder model is to CFD, until the surrogate's own test-split results replace it"
        />
        <CardBody>
          <KV rows={CALIBRATION} />
          <p className="mt-3 text-xs text-muted">
            Calibrated and checked on the same ten AirfRANS cases, all near Re ≈ 2 × 10⁶, so these are in-sample figures. The Reynolds-number
            trends, stall behaviour and the flow-field details away from those cases follow standard turbulent-flow correlations and are
            indicative only.
          </p>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Roadmap" description="Status of the production system behind this interface" />
        <CardBody>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ROADMAP.map((r) => (
              <li key={r.phase} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                {r.status === "done" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                ) : r.status === "active" ? (
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                )}
                <div>
                  <div className="tabular font-mono text-[10px] text-muted">PHASE {r.phase}</div>
                  <div className="text-xs text-fg-2">{r.title}</div>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
