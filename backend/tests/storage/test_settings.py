import pytest

from theta.storage import db


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "engine.db"))
    db.init(c)
    yield c
    c.close()


def test_fresh_database_returns_defaults(conn):
    assert db.get_settings(conn) == db.DEFAULT_SETTINGS


def test_engine_is_off_and_manual_by_default():
    """Nothing scans or alerts until someone switches it on."""
    assert db.DEFAULT_SETTINGS["engine_enabled"] is False
    assert db.DEFAULT_SETTINGS["mode"] == "manual"


def test_default_modes_are_the_ones_that_survived_the_bear_market():
    assert db.DEFAULT_SETTINGS["modes"] == ["ivrich"]


def test_put_settings_persists_and_merges(conn):
    out = db.put_settings(conn, {"engine_enabled": True, "watchlist": ["SPY", "QQQ"]})
    assert out["engine_enabled"] is True
    assert out["watchlist"] == ["SPY", "QQQ"]
    assert out["dtes"] == db.DEFAULT_SETTINGS["dtes"]
    assert db.get_settings(conn) == out


def test_put_settings_rejects_unknown_key(conn):
    with pytest.raises(ValueError, match="unknown setting"):
        db.put_settings(conn, {"leverage": 10})


def test_put_settings_rejects_wrong_type(conn):
    with pytest.raises(ValueError, match="interval_min"):
        db.put_settings(conn, {"interval_min": "fifteen"})


def test_put_settings_rejects_bool_where_number_expected(conn):
    """bool is a subclass of int in Python; True must not become an interval of 1."""
    with pytest.raises(ValueError, match="interval_min"):
        db.put_settings(conn, {"interval_min": True})


def test_put_settings_accepts_int_for_float(conn):
    assert db.put_settings(conn, {"max_deployed_risk": 3000})["max_deployed_risk"] == 3000


def test_put_settings_accepts_auto_mode(conn):
    assert db.put_settings(conn, {"mode": "auto"})["mode"] == "auto"


def test_put_settings_rejects_unknown_mode(conn):
    with pytest.raises(ValueError, match="mode"):
        db.put_settings(conn, {"mode": "yolo"})


def test_autotrade_defaults():
    s = db.DEFAULT_SETTINGS
    assert (s["tp_pct"], s["sl_multiple"], s["min_credit"]) == (80.0, 2.0, 0.30)
    assert (s["bot_paused"], s["bot_pause_reason"]) == (False, "")


@pytest.mark.parametrize("update", [{"tp_pct": 0}, {"tp_pct": 100}, {"sl_multiple": 0}, {"min_credit": 0.01}])
def test_autotrade_settings_are_range_checked(conn, update):
    with pytest.raises(ValueError):
        db.put_settings(conn, update)


def test_put_settings_rejects_unknown_signal_mode(conn):
    with pytest.raises(ValueError, match="modes"):
        db.put_settings(conn, {"modes": ["ivrich", "yolo"]})


def test_put_settings_rejects_empty_watchlist(conn):
    with pytest.raises(ValueError, match="watchlist"):
        db.put_settings(conn, {"watchlist": []})


def test_rejected_update_changes_nothing(conn):
    with pytest.raises(ValueError):
        db.put_settings(conn, {"engine_enabled": True, "leverage": 10})
    assert db.get_settings(conn)["engine_enabled"] is False


def test_watchlist_is_uppercased(conn):
    assert db.put_settings(conn, {"watchlist": ["spy", " qqq "]})["watchlist"] == ["SPY", "QQQ"]


def test_put_settings_accepts_custom_dtes_sorted_and_deduped(conn):
    assert db.put_settings(conn, {"dtes": [30, 7, 30]})["dtes"] == [7, 30]


@pytest.mark.parametrize("dtes", [[], [0], [-7], [366], [7.5], ["7"], [True]])
def test_put_settings_rejects_impossible_dtes(conn, dtes):
    with pytest.raises(ValueError, match="dtes"):
        db.put_settings(conn, {"dtes": dtes})


def test_credentials_are_stored_as_given_and_empty_by_default():
    s = db.DEFAULT_SETTINGS
    assert s["ai_api_key"] == "" and s["telegram_bot_token"] == ""
    assert s["ai_api_endpoint"] == "" and s["ai_model"] == ""
    assert s["telegram_chat_id"] == ""


@pytest.mark.parametrize("key", ["ai_api_key", "ai_api_endpoint", "ai_model",
                                "telegram_bot_token", "telegram_chat_id"])
def test_a_credential_must_be_a_string(conn, key):
    assert db.put_settings(conn, {key: "x"})[key] == "x"
    with pytest.raises(ValueError, match=key):
        db.put_settings(conn, {key: 5})

def test_only_bull_puts_at_7_dte_are_on_by_default():
    """Bull puts carried the edge under the bot's exits; bear calls and 14 DTE were thin."""
    assert db.DEFAULT_SETTINGS["directions"] == ["SELL_PUT"]
    assert db.DEFAULT_SETTINGS["dtes"] == [7]


@pytest.mark.parametrize("value", [[], ["SELL_PUT", "BUY_CALL"], ["NO_TRADE"]])
def test_put_settings_rejects_bad_directions(conn, value):
    with pytest.raises(ValueError, match="directions"):
        db.put_settings(conn, {"directions": value})


def test_bull_put_only_is_accepted(conn):
    assert db.put_settings(conn, {"directions": ["SELL_PUT"]})["directions"] == ["SELL_PUT"]
