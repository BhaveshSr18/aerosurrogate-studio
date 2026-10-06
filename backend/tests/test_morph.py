"""Mesh morphing against real AirfRANS meshes (needs data/base_meshes; skipped otherwise)."""

import itertools

import numpy as np
import pytest

from aerostudio.meshing.library import BaseMeshLibrary
from aerostudio.meshing.morph import (
    build_features,
    directed_edges,
    edge_features,
    morph,
    wall_normals,
)
from aerostudio.settings import settings

lib_dir = settings.base_mesh_dir
pytestmark = pytest.mark.skipif(not (lib_dir / "manifest.json").exists(), reason="base-mesh library not built")


@pytest.fixture(scope="module")
def lib():
    return BaseMeshLibrary(lib_dir)


def test_features_reproduce_airfrans_preprocessing(lib):
    """Rebuilding features on an unmorphed mesh must give the stored graph features."""
    for entry in lib.entries:
        b = lib.load(entry["id"])
        x = build_features(b.pos, b, b.params, entry["aoa_deg"], entry["u_inf"])
        np.testing.assert_array_equal(x[:, 2], b.x[:, 2])  # sdf: bit-identical
        s = b.surface
        cos = (x[s, 4:6] * b.x[s, 4:6]).sum(1)
        assert np.degrees(np.arccos(np.clip(cos, -1, 1))).max() < 0.5, entry["id"]
        np.testing.assert_allclose(x[:, 6:8], b.x[:, 6:8], atol=1e-3)
        np.testing.assert_allclose(x[:, 8:12], b.x[:, 8:12], atol=1e-6)


def test_edge_order_and_attrs_match_build_edge_index(lib):
    b = lib.load(lib.entries[0]["id"])
    ei = directed_edges(b.edges)
    assert ei.shape[1] == 2 * b.edges.shape[1]
    assert (np.diff(ei[0]) >= 0).all()
    ea = edge_features(b.pos, ei)
    np.testing.assert_allclose(ea[:, 2], np.linalg.norm(ea[:, :2], axis=1), rtol=1e-6)


def test_self_morph_is_near_identity(lib):
    """Morphing a mesh onto its own shape moves nodes only by the generator's residual."""
    b = lib.load(lib.entries[0]["id"])
    new_pos, report = morph(b, b.params)
    assert report.ok
    assert np.abs(new_pos - b.pos).max() < 1e-3
    assert report.min_scaled_jacobian == pytest.approx(report.base_min_scaled_jacobian, abs=0.02)


@pytest.mark.slow
def test_all_pairs_morph_without_inverted_cells(lib):
    ids = [e["id"] for e in lib.entries]
    for i, j in itertools.permutations(ids, 2):
        _, r = morph(lib.load(i), lib.load(j).params)
        assert r.n_inverted == 0 and r.ok, (i, j, r)


def test_normals_point_into_body(lib):
    b = lib.load(lib.entries[0]["id"])
    n = wall_normals(b.pos, b.edges, b.surface)
    s = b.surface
    centroid = b.pos[s].mean(0)
    # Away from the thin trailing edge, inward normals point toward the centroid.
    mid = s & (b.pos[:, 0] > 0.05) & (b.pos[:, 0] < 0.6)
    assert ((n[mid] * (centroid - b.pos[mid])).sum(1) > 0).mean() > 0.95
