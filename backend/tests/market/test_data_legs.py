"""fetch_legs must not price a leg on a missing quote."""
import math

import pandas as pd
import pytest

from theta.market import data as market_data

NAN = float("nan")


@pytest.fixture
def chain(monkeypatch):
    def install(rows):
        codes = [r["code"] for r in rows]
        chain_df = pd.DataFrame({"code": codes, "option_type": "PUT",
                                 "strike_price": [r["strike"] for r in rows]})
        snap = pd.DataFrame([{k: v for k, v in r.items() if k != "strike"} for r in rows])

        def call(method, *a, **k):
            return (0, chain_df) if method == "get_option_chain" else (0, snap)
        monkeypatch.setattr(market_data, "_call", call)
    return install


def _row(code, strike, bid, ask, delta, last=1.0):
    return {"code": code, "strike": strike, "bid_price": bid, "ask_price": ask,
            "last_price": last, "option_delta": delta, "option_implied_volatility": 30.0,
            "option_open_interest": 500, "volume": 10}


def test_a_leg_without_an_ask_is_dropped_not_priced_off_the_last_trade(chain):
    chain([_row("A", 95, NAN, NAN, -0.30, last=2.0), _row("B", 90, 0.5, 0.6, -0.15)])
    legs = market_data.fetch_legs("SPY", "2026-10-02", "put", 100)
    assert [L["code"] for L in legs] == ["B"]


def test_a_leg_with_no_delta_is_dropped(chain):
    chain([_row("A", 95, 1.0, 1.2, NAN), _row("B", 90, 0.5, 0.6, -0.15)])
    legs = market_data.fetch_legs("SPY", "2026-10-02", "put", 100)
    assert [L["code"] for L in legs] == ["B"]


def test_a_zero_bid_is_a_real_quote(chain):
    chain([_row("B", 90, 0.0, 0.10, -0.05)])
    [leg] = market_data.fetch_legs("SPY", "2026-10-02", "put", 100)
    assert leg["price"] == pytest.approx(0.05)
    assert not any(isinstance(v, float) and math.isnan(v) for v in leg.values())
