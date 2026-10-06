import numpy as np
import pytest

from aerostudio.adapters_testing import FakeEngine
from aerostudio.settings import settings


@pytest.fixture(scope="session")
def fake_engine():
    return FakeEngine()


@pytest.fixture(scope="session")
def has_library():
    return (settings.base_mesh_dir / "manifest.json").exists()


@pytest.fixture(scope="session")
def client(fake_engine, has_library):
    if not has_library:
        pytest.skip("base-mesh library not built")
    from fastapi.testclient import TestClient

    from aerostudio.api.app import create_app

    with TestClient(create_app(engine=fake_engine)) as c:
        yield c


def design(**kw):
    d = {"family": "4", "naca4": {"M": 2, "P": 4, "T": 12}, "naca5": {"L": 2, "P": 3, "Q": 0, "T": 12}, "aoa": 4.0, "speed": 50.0}
    d.update(kw)
    return d


@pytest.fixture
def make_design():
    return design


np.seterr(all="ignore")
