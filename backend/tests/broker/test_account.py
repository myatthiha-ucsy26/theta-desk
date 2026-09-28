import pandas as pd
import pytest

from theta.broker import account


ACC = pd.DataFrame([{
    "total_assets": 25310.4, "cash": 18000.25, "power": 36000.5, "currency": "USD",
    "unrealized_pl": "N/A",
}])
POS = pd.DataFrame([
    {"code": "US.SPY260918P580000", "pl_val": 120.5, "pl_val_valid": True},
    {"code": "US.SPY260918P575000", "pl_val": -40.0, "pl_val_valid": True},
    {"code": "US.AAPL", "pl_val": 999.0, "pl_val_valid": False},
])


def test_summarize_reads_balances_and_sums_valid_position_pnl():
    assert account.summarize(ACC, POS) == {
        "net_value": 25310.4,
        "cash": 18000.25,
        "buying_power": 36000.5,
        "unrealized_pl": 80.5,
        "open_count": 3,
        "currency": "USD",
    }


def test_summarize_with_no_positions():
    s = account.summarize(ACC, pd.DataFrame(columns=["code", "pl_val", "pl_val_valid"]))
    assert s["unrealized_pl"] == 0
    assert s["open_count"] == 0


class FakeTradeCtx:
    def __init__(self, acc=(0, ACC), pos=(0, POS)):
        self.acc, self.pos, self.calls = acc, pos, []

    def accinfo_query(self, **kw):
        self.calls.append(("accinfo_query", kw))
        return self.acc

    def position_list_query(self, **kw):
        self.calls.append(("position_list_query", kw))
        return self.pos


def test_fetch_queries_the_real_account_only(monkeypatch):
    from futu import TrdEnv
    fake = FakeTradeCtx()
    monkeypatch.setattr(account, "ctx", lambda: fake)
    assert account.fetch()["net_value"] == 25310.4
    assert [kw["trd_env"] for _, kw in fake.calls] == [TrdEnv.REAL, TrdEnv.REAL]
    assert {name for name, _ in fake.calls} == {"accinfo_query", "position_list_query"}


def test_fetch_raises_on_opend_error(monkeypatch):
    monkeypatch.setattr(account, "ctx", lambda: FakeTradeCtx(acc=(-1, "not logged in")))
    with pytest.raises(RuntimeError, match="not logged in"):
        account.fetch()
