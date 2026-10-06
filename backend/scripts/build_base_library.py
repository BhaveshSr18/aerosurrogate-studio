"""Build the base-mesh library from preprocessed AirfRANS graphs (graph_*.pt).

Each graph becomes one compressed .npz holding what mesh morphing and the dataset views
need: node positions, the raw 12-column features, edges, quad cells (recovered from the
edge graph), the CFD ground truth and the design parameters. A manifest.json indexes them.

    python scripts/build_base_library.py --graphs "<dir with graph_*.pt>" --out data/base_meshes

Later (full dataset): the same format is written from raw AirfRANS cases, and a subset of
~30-60 shapes spread over NACA parameter space is selected as the production library.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aerostudio.geometry.naca import NacaParams, designation  # noqa: E402
from aerostudio.meshing.cells import recover_quads  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graphs", required=True, type=Path)
    ap.add_argument("--out", default=Path(__file__).resolve().parents[1] / "data" / "base_meshes", type=Path)
    args = ap.parse_args()

    import torch

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for path in sorted(args.graphs.glob("graph_*.pt")):
        t0 = time.time()
        g = torch.load(path, weights_only=False)
        x = g.x.numpy().astype(np.float32)
        ei = g.edge_index.numpy()
        undirected = ei[:, ei[0] < ei[1]].astype(np.int32)
        quads = recover_quads(x[:, :2].astype(np.float64), undirected)
        ux, uy = float(x[0, 6]), float(x[0, 7])
        params = NacaParams.from_raw(x[0, 8:12])
        case_id = path.stem
        np.savez_compressed(
            args.out / f"{case_id}.npz",
            x=x,
            edges=undirected,
            quads=quads,
            y=g.y.numpy().astype(np.float32) if getattr(g, "y", None) is not None else np.zeros((0, 4), np.float32),
        )
        entry = {
            "id": case_id,
            "designation": designation(params),
            "family": params.family,
            "naca_raw": [round(float(v), 4) for v in x[0, 8:12]],
            "canonical": params.canonical(),
            "u_inf": math.hypot(ux, uy),
            "aoa_deg": math.degrees(math.atan2(uy, ux)),
            "n_nodes": int(x.shape[0]),
            "n_edges": int(undirected.shape[1]),
            "n_quads": int(quads.shape[0]),
            "n_surface": int((x[:, 3] > 0.5).sum()),
            "has_ground_truth": bool(getattr(g, "y", None) is not None),
        }
        manifest.append(entry)
        print(f"{case_id}: {entry['designation']:>12}  nodes={entry['n_nodes']}  quads={entry['n_quads']}  "
              f"(expected ~{entry['n_edges'] - entry['n_nodes']})  {time.time() - t0:.1f}s")
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote {len(manifest)} meshes to {args.out}")


if __name__ == "__main__":
    main()
