"""The desk answers only to this machine, and only to properly declared JSON."""
import os

import pytest

from theta.api.security import allowed_hosts, hostname_of, is_local_request
from theta.storage import db


# ---------------- parsing the Host header ----------------

@pytest.mark.parametrize("header,expected", [
    ("localhost:5057", "localhost"),
    ("127.0.0.1:5057", "127.0.0.1"),
    ("127.0.0.1", "127.0.0.1"),
    ("[::1]:5057", "[::1]"),
    ("[::1]", "[::1]"),
    ("evil.example.com", "evil.example.com"),
    ("", ""),
])
def test_hostname_is_taken_without_its_port(header, expected):
    assert hostname_of(header) == expected


@pytest.mark.parametrize("header", [
    "evil.example.com",
    "evil.example.com:5057",
    # The classic near-miss: a name that merely starts with the loopback address.
    "127.0.0.1.evil.com",
    "localhost.evil.com:5057",
    "",
])
def test_a_foreign_host_is_not_local(header):
    assert is_local_request(header, environ={}) is False


@pytest.mark.parametrize("header", ["localhost:5057", "LOCALHOST:5057", "127.0.0.1:5057", "[::1]:5057"])
def test_the_loopback_names_are_local(header):
    assert is_local_request(header, environ={}) is True


def test_extra_hosts_are_additive_so_loopback_never_breaks():
    env = {"THETA_ALLOWED_HOSTS": "desk.lan, trading-box"}
    assert is_local_request("desk.lan:5057", environ=env) is True
    assert is_local_request("127.0.0.1:5057", environ=env) is True
    assert is_local_request("evil.example.com", environ=env) is False
    assert "localhost" in allowed_hosts({})


# ---------------- the guard on real requests ----------------

def test_a_rebound_domain_cannot_read_the_book(client):
    """A page that points its own domain at 127.0.0.1 becomes same-origin with the
    desk. The Host header is the one thing that still names the attacker."""
    resp = client.get("/api/paper", headers={"Host": "evil.example.com"})
    assert resp.status_code == 403
    assert "localhost" in resp.get_json()["error"]


def test_a_rebound_domain_cannot_switch_the_account_to_live(client):
    resp = client.post("/api/settings", json={"account_mode": "live"},
                       headers={"Host": "evil.example.com"})
    assert resp.status_code == 403


def test_a_rebound_domain_cannot_close_positions(client):
    resp = client.post("/api/bot/close-all", json={"confirm": "CLOSE"},
                       headers={"Host": "evil.example.com"})
    assert resp.status_code == 403


def test_the_guard_covers_every_route(client):
    """Not a list of protected endpoints -- the whole app, so a new blueprint
    cannot be added without it."""
    from theta.api import create_app
    from theta.context import AppContext
    app = create_app(AppContext())
    paths = [r.rule for r in app.url_map.iter_rules()
             if "<" not in r.rule and r.rule != "/static/<path:filename>"]
    assert len(paths) > 20
    for path in paths:
        resp = client.get(path, headers={"Host": "evil.example.com"})
        assert resp.status_code == 403, path


def test_the_real_ui_still_works(client):
    assert client.get("/api/settings", headers={"Host": "127.0.0.1:5057"}).status_code == 200
    assert client.get("/api/settings", headers={"Host": "localhost:5057"}).status_code == 200


# ---------------- content type ----------------

def test_a_form_post_cannot_write_to_the_book(client):
    """text/plain is a "simple" request: no preflight, so any page can send it.
    Parsing it as JSON anyway is what made this reachable from the whole web."""
    resp = client.post("/api/paper/open",
                       data='{"ticker":"CSRF","direction":"SELL_PUT","short_strike":1,'
                            '"long_strike":2,"width":5,"credit":1,"expiry":"2099-01-01"}',
                       content_type="text/plain")
    assert resp.status_code == 400
    assert client.get("/api/paper").get_json()["open"] == []


def test_closing_a_position_needs_declared_json_too(client):
    resp = client.post("/api/paper/close", data='{"id":"x"}', content_type="text/plain")
    assert resp.status_code == 400


# ---------------- secrets at rest ----------------

def test_the_database_is_not_readable_by_anyone_else(tmp_path):
    """It stores the AI key and the Telegram token in clear text."""
    path = str(tmp_path / "book" / "engine.db")
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"ai_api_key": "sk-secret"})
    conn.close()
    assert os.stat(path).st_mode & 0o077 == 0
    assert os.stat(os.path.dirname(path)).st_mode & 0o077 == 0


def test_a_database_that_arrives_world_readable_is_locked_down(tmp_path):
    """Restored from a backup or copied off another machine, it keeps that mode
    until something takes it away."""
    path = str(tmp_path / "engine.db")
    open(path, "w").close()
    os.chmod(path, 0o644)
    db.connect(path).close()
    assert os.stat(path).st_mode & 0o777 == 0o600
