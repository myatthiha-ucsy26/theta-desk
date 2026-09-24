"""The live signal ranks vol with the same statistic the edge table was bucketed on."""
import pandas as pd
import pytest

from theta import signals
from theta.engine import edge
from theta.market import data as market_data


def calm_then_wild(n=320, tail=25):
    c = [100.0]
    for i in range(n - tail):
        c.append(c[-1] * (1.001 if i % 2 else 0.999))
    for i in range(tail):
        c.append(c[-1] * (1.04 if i % 2 else 0.96))
    return c


@pytest.fixture
def market(monkeypatch):
    closes = calm_then_wild()
    asked = {}

    def klines(ticker, bars=120):
        asked["bars"] = bars
        tail = closes[-bars:]
        return pd.DataFrame({"high": [c * 1.01 for c in tail], "low": [c * 0.99 for c in tail],
                             "close": tail})

    monkeypatch.setattr(market_data, "recent_klines", klines)
    monkeypatch.setattr(market_data, "get_spot", lambda tk: closes[-1])
    monkeypatch.setattr(market_data, "pick_expiration", lambda tk, d: ("2026-10-02", 7))
    monkeypatch.setattr(market_data, "atm_iv", lambda tk, exp, spot: 0.40)
    monkeypatch.setattr(market_data, "log_iv", lambda tk, iv: None)
    monkeypatch.setattr(market_data, "fetch_legs", lambda *a, **k: [])
    return closes, asked


def test_rank_is_the_edge_tables_realised_vol_percentile(market):
    closes, asked = market
    out = signals.evaluate("SPY", 7, ["ivrich"])
    assert asked["bars"] >= 300   # a year of ranks needs ~272 bars
    assert out["iv_rank"] == round(edge.rank_from_closes(closes[-asked["bars"]:]), 2)
