# AeroSurrogate Studio

Web interface for airfoil design and optimization driven by a **MeshGraphNet CFD surrogate** trained on the
[AirfRANS](https://airfrans.readthedocs.io) dataset. The surrogate model itself lives in a separate repository (`AirfransProject_migration`).

> **Status: preview build.** The UI, workflows and API contract are complete. The physics comes from an
> in-browser **placeholder**: a Hess–Smith panel method plus empirical viscous, stall and uncertainty models.
> It is swapped for the trained surrogate by setting `NEXT_PUBLIC_API_MODE=live` once the FastAPI backend
> exists (see [Backend contract](#backend-contract)).

## Pages

| Route | What it does |
|---|---|
| `/` | Landing page with a live particle-flow hero, pipeline explainer and capabilities |
| `/studio` | Design Studio: NACA 4/5-digit parameters, AoA and speed. Shows the flow field (Cp, \|U\|, Ux, Uy, νt, with streamlines and a hover probe), the Cp distribution, Cl/Cd/L/D/Cm ± σ, drag breakdown, training-envelope and mesh-morph checks, a share link, and export (.dat, .json, .csv) |
| `/polar` | AoA sweeps: lift curve with a ±σ band, drag polar, L/D, Cm; overlays up to 3 saved designs; table view; CSV export |
| `/optimize` | GA / NSGA-II optimizer: objectives (max L/D, min Cd at target Cl, max Cl, robust L/D, Pareto L/D–Cl), variable bounds, thickness / Cm / envelope constraints, live convergence and population plots, best design vs baseline |
| `/compare` | Up to 4 saved designs: shape overlay, Cp overlay, coefficient table with deltas against a chosen baseline |
| `/model` | Model card: architecture, data, training setup, acceptance criteria (pending), limitations, roadmap |

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production
```

Requires Node 20+. Every page is statically prerendered, so the site deploys as-is to Vercel, Netlify,
Azure Static Web Apps or any static host.

## Architecture

```
src/
  app/                    routes (App Router); each page = server shell + client view
  components/
    ui/                   design-system primitives (Radix-based)
    viz/                  FieldCanvas (raster + streamlines + probe), XYChart (SVG), AirfoilShape, HeroFlow
    design/               Studio panels (controls, metrics, validity)
  lib/
    api/client.ts         SurrogateClient interface; picks mock or live by env
    api/mock-client.ts    placeholder implementation (fields and optimizer run in Web Workers)
    api/http-client.ts    live implementation against the planned FastAPI endpoints
    physics/              NACA geometry, panel method, mock surrogate, envelope checks
    optimizer/engine.ts   real-coded GA + NSGA-II (constraint domination, SBX, polynomial mutation)
    store.ts              zustand store (current design, saved designs), persisted to localStorage
```

Components only talk to `api` (the `SurrogateClient` interface), so replacing the mock with the real surrogate changes no UI code.

## Backend contract

The live client (`src/lib/api/http-client.ts`) expects:

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/health` | `ModelInfo` (model name, version, checkpoint) |
| GET | `/api/envelope` | `Envelope`: training-split input ranges (from `compute_stats.py` metadata) |
| POST | `/api/predict` `{design, ensemble}` | `Prediction`: coefficients, σ, envelope checks, mesh-morph report, surface Cp |
| GET | `/api/results/{id}/field?window=near\|wake` | near-field rasterized onto a regular grid (`FieldData`) |
| POST | `/api/sweep` | `PolarPoint[]` |
| POST | `/api/optimize` | `{job_id}`; progress via SSE on `/api/jobs/{id}/stream` (`progress` and `done` events), cancel with `DELETE /api/jobs/{id}` |

All types are defined in `src/lib/types.ts`.

## Placeholders to replace

- **Physics:** `lib/physics/mock-model.ts` → trained MeshGraphNet via the backend.
- **Envelope ranges:** `lib/physics/envelope.ts` (`DEFAULT_ENVELOPE`, nominal AirfRANS ranges) → `/api/envelope`.
- **Mesh-morph report:** `mockMesh()` → output of the morphing engine (roadmap Phase 1).
- **5-digit geometry:** textbook conventions (design Cl = 0.15 L, p = P/20) still need checking against the AirfRANS generator.
- **GPU time estimate:** `EST_SECONDS_PER_EVAL_GPU` in the optimizer page → Phase 0 benchmark.
- **Model-card metrics:** "Pending" → measured test-split results.
- **Footer author links.**
