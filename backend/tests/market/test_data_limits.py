import pandas as pd
import pytest

from theta.market import data as market_data
from theta.market import ratelimit


class CountingLimiter:
    window = 30.0

    def __init__(self):
        self.calls = 0

    def acquire(self):
        self.calls += 1
        return 0.0


class FakeCtx:
    """Scripted OpenD replies per method; records each call."""
    def __init__(self, replies):
        self.replies = {k: list(v) for k, v in replies.items()}
        self.calls = []

    def __getattr__(self, name):
        def method(*a, **k):
            self.calls.append(name)
            return self.replies[name].pop(0)
        return method


FREQ = "Get Option Chain request failed due to high frequency. Maximum 10 times per 30 seconds."


@pytest.fixture
def limits(monkeypatch):
    fakes = {name: CountingLimiter() for name in market_data.LIMITS}
    monkeypatch.setattr(market_data, "LIMITS", fakes)
    monkeypatch.setattr(market_data, "_retry_sleep", lambda s: None)
    return fakes


def test_known_opend_limits_are_configured_below_the_documented_caps():
    assert market_data.LIMITS["get_option_chain"].max_calls <= 10
    assert market_data.LIMITS["get_option_chain"].window == 30.0
    for name in ("get_market_snapshot", "request_history_kline", "get_option_expiration_date"):
        assert isinstance(market_data.LIMITS[name], ratelimit.RateLimiter)
        assert market_data.LIMITS[name].max_calls <= 60


def test_every_call_goes_through_its_limiter(limits, monkeypatch):
    fake = FakeCtx({"get_market_snapshot": [(0, _snapshot_frame(123.4))]})
    monkeypatch.setattr(market_data, "_ctx", fake)
    assert market_data.get_spot("SPY") == 123.4
    assert limits["get_market_snapshot"].calls == 1


def test_high_frequency_error_is_retried_then_succeeds(limits, monkeypatch):
    import pandas as pd
    chain = pd.DataFrame({"code": [], "option_type": [], "strike_price": []})
    fake = FakeCtx({"get_option_chain": [(-1, FREQ), (0, chain)]})
    monkeypatch.setattr(market_data, "_ctx", fake)
    assert market_data.fetch_legs("SPY", "2026-10-02", "put", 100.0) == []
    assert fake.calls == ["get_option_chain", "get_option_chain"]
    assert limits["get_option_chain"].calls == 2


def test_persistent_high_frequency_error_eventually_raises(limits, monkeypatch):
    fake = FakeCtx({"get_option_chain": [(-1, FREQ)] * 5})
    monkeypatch.setattr(market_data, "_ctx", fake)
    with pytest.raises(RuntimeError, match="high frequency"):
        market_data.fetch_legs("SPY", "2026-10-02", "put", 100.0)
    assert len(fake.calls) == 3


def test_other_errors_are_not_retried(limits, monkeypatch):
    fake = FakeCtx({"get_option_chain": [(-1, "unknown stock")]})
    monkeypatch.setattr(market_data, "_ctx", fake)
    with pytest.raises(RuntimeError, match="unknown stock"):
        market_data.fetch_legs("SPY", "2026-10-02", "put", 100.0)
    assert len(fake.calls) == 1


def _snapshot_frame(price):
    import pandas as pd
    return pd.DataFrame({"last_price": [price]})


def test_fetch_legs_includes_code_bid_ask(monkeypatch):
    chain = pd.DataFrame([{"code": "US.SPY260930P731000", "option_type": "PUT", "strike_price": 731.0}])
    snap = pd.DataFrame([{"code": "US.SPY260930P731000", "bid_price": 2.80, "ask_price": 2.82,
                          "last_price": 2.81, "option_delta": -0.30,
                          "option_implied_volatility": 20.0, "option_open_interest": 900}])
    calls = {"get_option_chain": (0, chain), "get_market_snapshot": (0, snap)}
    monkeypatch.setattr(market_data, "_call", lambda method, *a, **k: calls[method])
    [leg] = market_data.fetch_legs("SPY", "2026-09-30", "put", 750.0)
    assert (leg["code"], leg["bid"], leg["ask"]) == ("US.SPY260930P731000", 2.80, 2.82)
    assert leg["price"] == pytest.approx(2.81)


def test_fetch_legs_carries_open_interest_and_volume(monkeypatch):
    chain = pd.DataFrame([{"code": "US.SPY260930P731000", "option_type": "PUT", "strike_price": 731.0}])
    snap = pd.DataFrame([{"code": "US.SPY260930P731000", "bid_price": 2.80, "ask_price": 2.82,
                          "last_price": 2.81, "option_delta": -0.30,
                          "option_implied_volatility": 20.0,
                          "option_open_interest": 14820, "volume": 3110}])
    calls = {"get_option_chain": (0, chain), "get_market_snapshot": (0, snap)}
    monkeypatch.setattr(market_data, "_call", lambda method, *a, **k: calls[method])
    [leg] = market_data.fetch_legs("SPY", "2026-09-30", "put", 750.0)
    assert (leg["oi"], leg["volume"]) == (14820, 3110)


def test_counts_survive_what_opend_sends_for_a_leg_it_has_no_data_on(monkeypatch):
    # NaN and "N/A" both reach here; int() would raise on either.
    chain = pd.DataFrame([{"code": "US.SPY260930P731000", "option_type": "PUT", "strike_price": 731.0},
                          {"code": "US.SPY260930P732000", "option_type": "PUT", "strike_price": 732.0}])
    snap = pd.DataFrame([{"code": "US.SPY260930P731000", "bid_price": 2.80, "ask_price": 2.82,
                          "last_price": 2.81, "option_delta": -0.30, "volume": "N/A"},
                         {"code": "US.SPY260930P732000", "bid_price": 2.70, "ask_price": 2.72,
                          "last_price": 2.71, "option_delta": -0.31, "volume": float("nan")}])
    calls = {"get_option_chain": (0, chain), "get_market_snapshot": (0, snap)}
    monkeypatch.setattr(market_data, "_call", lambda method, *a, **k: calls[method])
    legs = market_data.fetch_legs("SPY", "2026-09-30", "put", 750.0)
    assert [L["volume"] for L in legs] == [0, 0]
    assert [L["oi"] for L in legs] == [0, 0]


def test_quotes_returns_bid_ask_and_allows_zero_bid(monkeypatch):
    snap = pd.DataFrame([{"code": "A", "bid_price": 0.0, "ask_price": 0.05},
                         {"code": "B", "bid_price": 1.10, "ask_price": 1.15}])
    monkeypatch.setattr(market_data, "_call", lambda method, *a, **k: (0, snap))
    assert market_data.quotes(["A", "B"]) == {"A": {"bid": 0.0, "ask": 0.05}, "B": {"bid": 1.10, "ask": 1.15}}


def test_quotes_raises_without_an_ask(monkeypatch):
    snap = pd.DataFrame([{"code": "A", "bid_price": 1.0, "ask_price": 0.0}])
    monkeypatch.setattr(market_data, "_call", lambda method, *a, **k: (0, snap))
    with pytest.raises(RuntimeError, match="A"):
        market_data.quotes(["A"])
