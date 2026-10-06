"""A torch-free stand-in engine for tests and for exercising the API without a checkpoint.

Fields: freestream velocity with a thin wake-like deficit near the wall, pressure from
Bernoulli. Coefficients come from a thin-airfoil estimate. Nothing here is physics-grade;
it only has to be deterministic and shaped like the real engine's output.
"""

from __future__ import annotations

import math

import numpy as np

from aerostudio.engine.adapter import Inference


class FakeEngine:
    nu = 1.5498e-5
    chord = 1.0

    @property
    def info(self) -> dict:
        return {"name": "fake engine", "variant": "fake", "members": 2, "checkpoints": ["fake/run/best_model.pt"], "surrogate_commit": "0" * 40}

    @property
    def stats_meta(self) -> dict:
        names = ["u_inf", "aoa_deg", "is_5digit", "camber_param", "camber_pos", "reflex", "thickness"]
        pts = [[40, 2, 0, 2, 4, 0, 12], [60, 8, 1, 2, 4, 0, 14], [80, -2, 0, 4, 5, 0, 10]]
        return {"input_ranges": {"envelope": {
            "param_names": names, "min": [31, -5, 0, 0, 0, 0, 5], "max": [94, 15, 1, 7, 8, 1, 20],
            "mean": np.mean(pts, 0).tolist(), "std": np.std(pts, 0).clip(1e-3).tolist(), "points": pts, "nn_threshold": 50.0,
        }}}

    def infer(self, x, edge_index, edge_attr, with_checks: bool = True) -> Inference:
        u = x[0, 6:8].astype(np.float64)
        speed = float(np.hypot(*u))
        sdf = x[:, 2].astype(np.float64)
        factor = 1 - np.exp(-sdf / 0.01)
        fields = np.zeros((len(x), 4))
        fields[:, 0] = u[0] * factor
        fields[:, 1] = u[1] * factor
        fields[:, 2] = 0.5 * (speed**2 - (fields[:, 0] ** 2 + fields[:, 1] ** 2))
        fields[:, 3] = 1e-4 * np.exp(-sdf / 0.02)
        aoa = math.atan2(u[1], u[0])
        camber = float(x[0, 8]) / 100
        cl = 2 * math.pi * (aoa + 2 * camber)
        cd = 0.008 + 0.01 * cl**2
        coeffs = {"cl": cl, "cd": cd, "cl_p": cl, "cl_v": 0.0, "cd_p": cd * 0.3, "cd_v": cd * 0.7}
        return Inference(fields=fields, fields_std=None, coeffs=coeffs, coeffs_std={"cl": 0.01, "cd": 0.0005},
                         warnings=[])

    def coefficients_from_fields(self, x, edge_index, fields, u_inf_vec) -> dict:
        return {"cl": 0.0, "cd": 0.0, "cl_p": 0.0, "cl_v": 0.0, "cd_p": 0.0, "cd_v": 0.0}
