import pytest

from theta.context import AppContext
from theta.api import create_app


@pytest.fixture
def dist(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>Desk</title><div id=root></div>")
    (d / "assets" / "index-abc.js").write_text("console.log('desk')")
    return d


@pytest.fixture
def built(db_path, dist):
    return create_app(AppContext(db_path=db_path, frontend_dist=str(dist))).test_client()


def test_root_serves_the_ui_when_built(built):
    resp = built.get("/")
    assert resp.status_code == 200 and b"<title>Desk</title>" in resp.data


def test_built_assets_are_served(built):
    resp = built.get("/assets/index-abc.js")
    assert resp.status_code == 200 and b"desk" in resp.data


def test_root_explains_itself_when_the_ui_is_not_built(make_client, tmp_path):
    """There is no second dashboard to fall back to, so say what to run instead."""
    client = make_client(frontend_dist=str(tmp_path / "missing"))
    resp = client.get("/")
    assert resp.status_code == 503 and b"run.sh" in resp.data


def test_api_routes_are_not_shadowed(built):
    assert built.get("/api/settings").is_json
