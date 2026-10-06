"""Mesh cell utilities.

Preprocessed AirfRANS graphs keep only edges (from the QUAD cells). Mesh-quality checks
after morphing need the cells back: in a planar quad mesh every face is a chordless
4-cycle of the edge graph, so the cells are recovered exactly by enumerating 4-cycles
i-a-j-b with i < j where a, b are distinct common neighbours of i and j.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse


def recover_quads(pos: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """(F, 4) node indices of quad faces, counter-clockwise. edges: (2, E) undirected."""
    n = pos.shape[0]
    a = sparse.coo_matrix((np.ones(edges.shape[1] * 2, dtype=np.int32),
                           (np.r_[edges[0], edges[1]], np.r_[edges[1], edges[0]])), shape=(n, n)).tocsr()
    a.sort_indices()
    edge_keys = np.sort(np.minimum(edges[0], edges[1]).astype(np.int64) * n + np.maximum(edges[0], edges[1]))

    def adjacent(u: np.ndarray, v: np.ndarray) -> np.ndarray:
        k = np.minimum(u, v).astype(np.int64) * n + np.maximum(u, v)
        idx = np.clip(np.searchsorted(edge_keys, k), 0, len(edge_keys) - 1)
        return edge_keys[idx] == k

    # Candidate diagonals: non-adjacent pairs (i < j) with >= 2 common neighbours.
    a2 = (a @ a).tocoo()
    m = (a2.row < a2.col) & (a2.data >= 2)
    rows, cols = a2.row[m], a2.col[m]
    keep = ~adjacent(rows, cols)
    rows, cols = rows[keep], cols[keep]

    indptr, indices = a.indptr, a.indices
    found = []
    for i, j in zip(rows.tolist(), cols.tolist()):
        common = np.intersect1d(indices[indptr[i]:indptr[i + 1]], indices[indptr[j]:indptr[j + 1]], assume_unique=True)
        for x in range(common.size):
            for y in range(x + 1, common.size):
                found.append((i, int(common[x]), j, int(common[y])))
    cyc = np.asarray(found, dtype=np.int64).reshape(-1, 4)
    # Chordless: the other diagonal must not be an edge either.
    cyc = cyc[~adjacent(cyc[:, 1], cyc[:, 3])]
    # Each face is found once per diagonal (twice); deduplicate on the sorted node set.
    _, first = np.unique(np.sort(cyc, 1), axis=0, return_index=True)
    quads_arr = cyc[np.sort(first)].astype(np.int32)
    area = signed_areas(pos, quads_arr)
    flip = area < 0
    quads_arr[flip] = quads_arr[flip][:, ::-1]
    return quads_arr


def signed_areas(pos: np.ndarray, quads: np.ndarray) -> np.ndarray:
    """Shoelace area of each quad (positive = counter-clockwise)."""
    p = pos[quads]  # (F, 4, 2)
    x, y = p[..., 0], p[..., 1]
    return 0.5 * (x * np.roll(y, -1, axis=1) - np.roll(x, -1, axis=1) * y).sum(1)


def corner_jacobians(pos: np.ndarray, quads: np.ndarray) -> np.ndarray:
    """(F, 4) cross products of the two edges at each corner; all > 0 for a valid convex CCW quad."""
    p = pos[quads]
    prev = np.roll(p, 1, axis=1) - p
    nxt = np.roll(p, -1, axis=1) - p
    return nxt[..., 0] * prev[..., 1] - nxt[..., 1] * prev[..., 0]


def scaled_jacobian(pos: np.ndarray, quads: np.ndarray) -> np.ndarray:
    """Min over corners of the normalized corner Jacobian, in [-1, 1] (1 = rectangle)."""
    p = pos[quads]
    prev = np.roll(p, 1, axis=1) - p
    nxt = np.roll(p, -1, axis=1) - p
    cross = nxt[..., 0] * prev[..., 1] - nxt[..., 1] * prev[..., 0]
    norm = np.linalg.norm(prev, axis=-1) * np.linalg.norm(nxt, axis=-1)
    return (cross / np.maximum(norm, 1e-300)).min(1)
