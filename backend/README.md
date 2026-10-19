# AeroSurrogate Studio — backend

FastAPI service behind the web UI (`../frontend`). It turns a NACA design into a
MeshGraphNet prediction:

```
design ──► NACA geometry ──► base-mesh selection ──► mesh morphing + quality gate
       ──► feature rebuild (sdf, normals, inflow, NACA, edges) ──► surrogate (pinned repo)
       ──► coefficients, Cp, Cm, separation, field raster ──► JSON / SSE
```

The surrogate model is developed **separately** (`airfrans-meshgraphnet-surrogate`, checked out locally as `AirfransProject_migration`). This backend
imports it only in `aerostudio/engine/adapter.py`, from a checkout pinned by git commit.

## Layout

| Module | Role |
|---|---|
| `geometry/naca.py` | NACA 4/5-digit generator in AirfRANS case-name units |
| `meshing/cells.py` | quad recovery from the edge graph, cell quality metrics |
| `meshing/morph.py` | arc-length surface mapping, hybrid foot-point/IDW deformation, feature rebuild |
| `meshing/library.py` | base-mesh library, geometric base selection, cached `MeshService` |
| `engine/adapter.py` | **only** bridge to the surrogate repo (pin check, single model or ensemble) |
| `service.py` | prediction pipeline, envelope/mesh checks, single-flight result cache |
| `postproc.py` | surface Cp, Cm¼, separation indicator, field rasterization |
| `optimize.py` | pymoo GA / NSGA-II with the UI's objectives and constraints |
| `jobs.py` | in-process job manager (SSE event log, cancel); swappable for Redis + GPU worker |
| `api/` | FastAPI app and camelCase schemas mirroring `frontend/src/lib/types.ts` |

## Setup (Windows, CPU)

```bash
python -m venv .venv
.venv/Scripts/python -m pip install "torch==2.5.1" "torchvision==0.20.1" --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install torch_scatter -f https://data.pyg.org/whl/torch-2.5.0+cpu.html
.venv/Scripts/python -m pip install -c constraints.txt -e ".[surrogate,dev]"
```

`constraints.txt` keeps torch and warp-lang at the versions the surrogate repo supports. Without it,
PhysicsNeMo pulls in torch 2.14 and torch_scatter stops loading.

Build the base-mesh library from preprocessed graphs, then run:

```bash
.venv/Scripts/python scripts/build_base_library.py --graphs "../../AirfRANS Latest"
set AEROSTUDIO_CHECKPOINTS=<path>/best_model.pt[,<member2>.pt,...]
.venv/Scripts/python -m uvicorn aerostudio.api.app:app --port 8000
```

Frontend in live mode: `NEXT_PUBLIC_API_MODE=live npm run build && npm start` in `../frontend`.

Settings are `AEROSTUDIO_*` environment variables (see `aerostudio/settings.py`):
`SURROGATE_REPO`, `SURROGATE_COMMIT`, `SURROGATE_PIN_MODE` (strict|warn), `CHECKPOINTS`, `DEVICE`, `BASE_MESH_DIR`, …

## Validation so far (10 local AirfRANS cases)

- **Geometry.** The generator matches the true AirfRANS wall nodes within 0.2×10⁻³ c for all
  standard 4- and 5-digit cases, which confirms design Cl = 0.15 L, p = P/20 and the closed
  trailing edge. The one reflexed case matches within 0.56×10⁻³ c.
- **Features.** Rebuilt on unmorphed meshes: sdf is bit-identical, wall normals are within
  0.5°, and `edge_index` / `edge_attr` are identical to the surrogate's preprocessing.
- **Morphing.** All 90 pairwise morphs (thickness 5.6 % ↔ 19.5 %, 4↔5-digit) pass with no
  inverted cells, and the minimum scaled Jacobian never drops below the base mesh's own. About 2 s
  per morph on a laptop CPU.
- **Not validated yet:** surrogate accuracy on morphed versus true meshes. That needs the trained model
  (`/api/dataset/cases/{id}/compare` and a morph study are ready for it).

## Performance (laptop, 4 threads)

| Step | Time |
|---|---|
| morph + features (new shape; cached afterwards) | ~2 s |
| smoke model inference (26k params) | ~1.3 s |
| **production-size model (2.3M params, 15 layers) inference** | **~45 s, 3 GB RAM** |

So the production model needs a GPU for interactive use and optimization.

## Tests

```bash
.venv/Scripts/python -m pytest -m "not slow"   # ~1 min
.venv/Scripts/python -m pytest                  # + all-pairs morphing, ~4 min
```
