"""Check the analytic NACA generator against the airfoil surface nodes of real AirfRANS meshes.

For every base mesh, the distance from each true surface node to the generated contour
is measured (in chord units). Variants of the uncertain conventions are compared so the
generator uses whichever matches AirfRANS.

    python scripts/validate_geometry.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aerostudio.geometry.naca import NacaParams, airfoil  # noqa: E402


def contour_distance(surface: np.ndarray, p: NacaParams, closed_te: bool) -> np.ndarray:
    dense = airfoil(p, n_side=4000, closed_te=closed_te).loop
    return cKDTree(dense).query(surface)[0]


def main():
    lib = ROOT / "data" / "base_meshes"
    manifest = json.loads((lib / "manifest.json").read_text())
    print(f"{'case':<14}{'designation':>12}  {'raw params':<28}{'closed TE max/rms':>20}{'open TE max/rms':>20}")
    for e in manifest:
        x = np.load(lib / f"{e['id']}.npz")["x"]
        surf = x[x[:, 3] > 0.5][:, :2].astype(np.float64)
        p = NacaParams.from_raw(e["naca_raw"])
        cols = []
        for closed in (True, False):
            d = contour_distance(surf, p, closed)
            cols.append(f"{d.max() * 1e3:7.3f}/{np.sqrt((d**2).mean()) * 1e3:6.3f}")
        print(f"{e['id']:<14}{e['designation']:>12}  {str(e['naca_raw']):<28}{cols[0]:>20}{cols[1]:>20}   (×1e-3 c)")


if __name__ == "__main__":
    main()
