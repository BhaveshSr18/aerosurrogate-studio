# AeroSurrogate Studio

Airfoil design and optimization driven by a **MeshGraphNet CFD surrogate** trained on the
[AirfRANS](https://airfrans.readthedocs.io) dataset (2D incompressible RANS, k-ω SST).

**Live preview:** https://frontend-three-vert-90.vercel.app

| Folder | What it is |
|---|---|
| [`frontend/`](frontend/README.md) | Next.js 15 web app: Design Studio, polars, GA / NSGA-II optimizer, compare, model card |
| [`backend/`](backend/README.md) | FastAPI service: NACA geometry, mesh morphing, surrogate inference, optimization jobs |

The surrogate model itself (training, preprocessing, evaluation) lives in a separate repository,
`airfrans-meshgraphnet-surrogate` (private; checked out locally as `AirfransProject_migration`).
The backend imports it from a checkout pinned by git commit (`AEROSTUDIO_SURROGATE_COMMIT`).

## Status

- **Frontend:** deployed on Vercel in preview mode. Until a fully trained checkpoint exists, results come
  from an in-browser placeholder (panel method + empirical viscous model) calibrated on AirfRANS ground
  truth: Cl MAE 0.016, Cd error 1.2 %, surface-Cp RMS 0.047 on the ten base-mesh cases.
- **Backend:** complete and tested against a smoke checkpoint; the production-size model needs a GPU for
  interactive use (about 45 s per inference on a laptop CPU).
- **Next step:** full training run, then switch the frontend to `NEXT_PUBLIC_API_MODE=live`.

## Quick start

```bash
# frontend (Node 20+)
cd frontend
npm install
npm run dev            # http://localhost:3000
npm run check          # typecheck + lint + tests

# backend (Python 3.10+); see backend/README.md for the torch / torch_scatter setup
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -c constraints.txt -e ".[surrogate,dev]"
.venv/Scripts/python -m pytest -m "not slow"
```

`backend/data/` (base-mesh library, ~61 MB) and model checkpoints are not in git. Rebuild the library
with `backend/scripts/build_base_library.py` from the preprocessed AirfRANS graphs.

## Data attribution

The ground-truth summary numbers in `frontend/src/test/fixtures/airfrans-truth.json` are derived from
the [AirfRANS](https://airfrans.readthedocs.io) dataset (Bonnet et al., NeurIPS 2022 Datasets and
Benchmarks), which is released under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). The dataset itself is
not redistributed in this repository.
