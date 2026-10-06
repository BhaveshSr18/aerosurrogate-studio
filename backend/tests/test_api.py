"""HTTP contract tests (fake engine, real meshes and morphing)."""

import json


def test_health_and_envelope(client):
    h = client.get("/api/health").json()
    assert h["mode"] == "live" and h["status"] == "unvalidated"
    env = client.get("/api/envelope").json()
    assert set(env["naca4"]) == {"M", "P", "T"} and set(env["naca5"]) == {"L", "P", "T"}
    assert env["provisional"] is False


def test_predict_contract(client, make_design):
    r = client.post("/api/predict", json={"design": make_design(), "ensemble": True})
    assert r.status_code == 200, r.text
    p = r.json()
    for key in ("id", "cl", "cd", "cm", "ld", "clPressure", "cdViscous", "uncertainty", "envelope", "mesh", "surface", "stalled", "timingMs", "modelVersion"):
        assert key in p
    assert len(p["surface"]["x"]) == len(p["surface"]["cpUpper"]) == len(p["surface"]["cpLower"]) == 101
    assert p["mesh"]["status"] == "pass" and p["mesh"]["nodes"] > 100_000
    assert {c["key"] for c in p["envelope"]} >= {"M", "P", "T", "aoa", "speed"}

    f = client.get(f"/api/results/{p['id']}/field", params={"window": "near"}).json()
    assert f["nx"] == 260 and len(f["vars"]["cp"]) == f["nx"] * f["ny"]
    assert any(v is None for v in f["vars"]["cp"])  # airfoil interior masked
    assert client.get("/api/results/nope/field").status_code == 404


def test_five_digit_and_out_of_envelope(client, make_design):
    d = make_design(family="5", aoa=18.0)
    p = client.post("/api/predict", json={"design": d}).json()
    aoa = next(c for c in p["envelope"] if c["key"] == "aoa")
    assert aoa["status"] == "fail"


def test_sweep(client, make_design):
    r = client.post("/api/sweep", json={"design": make_design(), "aoaStart": -2, "aoaEnd": 6, "aoaStep": 2})
    pts = r.json()
    assert [p["aoa"] for p in pts] == [-2, 0, 2, 4, 6]
    assert pts[-1]["cl"] > pts[0]["cl"]
    assert client.post("/api/sweep", json={"design": make_design(), "aoaStart": -5, "aoaEnd": 15, "aoaStep": 0.1}).status_code == 422


def test_optimize_streams_progress_and_result(client):
    cfg = {
        "family": "4", "objective": "max_ld", "variables": [
            {"key": "M", "enabled": True, "min": 1, "max": 4, "fixed": 2},
            {"key": "P", "enabled": False, "min": 2, "max": 6, "fixed": 4},
            {"key": "T", "enabled": False, "min": 10, "max": 14, "fixed": 12},
            {"key": "aoa", "enabled": True, "min": 0, "max": 6, "fixed": 4},
        ],
        "speed": 50, "populationSize": 6, "generations": 2, "seed": 1,
        "constraints": {"minThickness": 10},
    }
    job = client.post("/api/optimize", json=cfg).json()
    events = []
    with client.stream("GET", f"/api/jobs/{job['jobId']}/stream") as s:
        name = None
        for line in s.iter_lines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                events.append((name, json.loads(line.split(":", 1)[1])))
    kinds = [e[0] for e in events]
    assert kinds.count("progress") == 3 and kinds[-1] == "done", kinds
    done = events[-1][1]
    assert done["best"]["feasible"] and done["top"] and done["history"][-1]["generation"] == 2


def test_dataset_cases(client):
    cases = client.get("/api/dataset/cases").json()
    assert len(cases) >= 1 and cases[0]["has_ground_truth"]
