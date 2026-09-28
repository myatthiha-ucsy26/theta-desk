import datetime as dt

import pandas as pd
import pytest

from theta.market import data as market_data

TODAY = dt.date(2026, 9, 16)


class CountingLimiter:
    window = 30.0

    def __init__(self):
        self.calls = 0

    def acquire(self):
        self.calls += 1
        return 0.0


class FakeCtx:
    def __init__(self, chain, iv_by_code):
        self.chain, self.iv_by_code = chain, iv_by_code
        self.chain_calls, self.snapshot_sizes = [], []

    def get_option_chain(self, **kw):
        self.chain_calls.append(kw)
        return 0, self.chain

    def get_market_snapshot(self, codes):
        self.snapshot_sizes.append(len(codes))
        return 0, pd.DataFrame({"code": codes,
                                "option_implied_volatility": [self.iv_by_code[c] for c in codes]})


def _chain(expiries, strikes):
    rows = []
    for e in expiries:
        for k in strikes:
            for t in ("PUT", "CALL"):
                rows.append({"code": f"{e}{t[0]}{k}", "option_type": t, "strike_time": e, "strike_price": float(k)})
    return pd.DataFrame(rows)


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(market_data, "LIMITS", {n: CountingLimiter() for n in market_data.LIMITS})
    monkeypatch.setattr(market_data, "_retry_sleep", lambda s: None)

    def make(expiries, strikes, iv=25.0):
        chain = _chain(expiries, strikes)
        fake = FakeCtx(chain, {c: iv for c in chain["code"]})
        monkeypatch.setattr(market_data, "_ctx", fake)
        return fake
    return make


def test_uses_one_chain_request_for_all_expirations(setup):
    fake = setup(["2026-09-18", "2026-09-25", "2026-10-02"], [95, 100, 105])
    market_data.iv_surface_points("SPY", 100.0, today=TODAY)
    assert len(fake.chain_calls) == 1
    assert fake.chain_calls[0]["start"] == "2026-09-17"
    assert fake.chain_calls[0]["end"] == "2026-10-16"


def test_keeps_out_of_the_money_side_within_range_as_decimal_iv(setup):
    setup(["2026-09-18"], [85, 95, 100, 105, 115])
    pts = market_data.iv_surface_points("SPY", 100.0, today=TODAY, pct=0.10)
    got = sorted((p["strike"], p["iv"]) for p in pts)
    # 85 and 115 are outside +/-10%; 100 appears once as a put and once as a call.
    assert got == [(95.0, 0.25), (100.0, 0.25), (100.0, 0.25), (105.0, 0.25)]
    assert {p["dte"] for p in pts} == {2}


def test_limits_to_max_expiries(setup):
    exps = [(TODAY + dt.timedelta(days=d)).isoformat() for d in range(1, 13)]
    setup(exps, [100])
    pts = market_data.iv_surface_points("SPY", 100.0, today=TODAY, max_expiries=4)
    assert len({p["expiry"] for p in pts}) == 4


def test_snapshots_are_batched(setup):
    fake = setup(["2026-09-18"], list(range(90, 111)))  # 21 strikes -> 22 OTM contracts
    market_data.iv_surface_points("SPY", 100.0, today=TODAY, batch=10)
    assert fake.snapshot_sizes == [10, 10, 2]


def test_contracts_without_iv_are_skipped(setup):
    fake = setup(["2026-09-18"], [95, 105])
    for code in fake.iv_by_code:
        fake.iv_by_code[code] = 0 if code.endswith("95") else 30.0
    pts = market_data.iv_surface_points("SPY", 100.0, today=TODAY)
    assert [p["strike"] for p in pts] == [105.0]