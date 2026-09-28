"""The bot driven end to end against the simulated broker.

This is the point of paper mode: the same monitor, the same autotrade rules,
the same order lifecycle, with nothing reaching a funded account.
"""
import datetime as dt

import pytest

from tests import fakes as f
from theta.broker.paper import PaperBroker
from theta.engine import monitor
from theta.storage import db

ACCOUNT = "paper"
NOW = f.NOW


class Market:
    def __init__(self):
        self.short, self.long = (0.80, 0.90), (0.20, 0.30)

    def set(self, short=None, long=None):
        self.short, self.long = short or self.short, long or self.long

    def __call__(self, codes):
        q = {f.SHORT: {"bid": self.short[0], "ask": self.short[1]},
             f.LONG: {"bid": self.long[0], "ask": self.long[1]}}
        return {c: q[c] for c in codes}


@pytest.fixture
def desk(tmp_path):
    path = str(tmp_path / "paper.db")
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"mode": "auto", "account_mode": ACCOUNT})
    market = Market()

    def conn_fn():
        c = db.connect(path)
        db.init(c)
        return c

    def settings():
        c = conn_fn()
        try:
            return db.get_settings(c)
        finally:
            c.close()

    broker = PaperBroker(conn_fn, market, lambda: NOW, settings)
    svc = f.services(broker, quotes=market)
    yield conn, broker, market, svc
    conn.close()


def test_an_entry_waits_for_the_market_then_opens(desk):
    conn, broker, market, svc = desk
    monitor.enter(conn, f.decision(), db.get_settings(conn), svc, NOW)

    trades = db.list_live_trades(conn, account=ACCOUNT)
    assert len(trades) == 1 and trades[0]["state"] == "entering"
    assert trades[0]["account"] == ACCOUNT

    # The market is not paying the asked-for credit yet, so nothing fills.
    monitor.step(conn, db.get_settings(conn), svc, NOW)
    assert db.list_live_trades(conn, account=ACCOUNT)[0]["state"] == "entering"

    # Now it is.
    market.set(short=(2.00, 2.10))
    monitor.step(conn, db.get_settings(conn), svc, NOW + dt.timedelta(minutes=1))
    t = db.list_live_trades(conn, account=ACCOUNT)[0]
    assert t["state"] == "open" and t["credit"] is not None


def open_a_spread(conn, market, svc):
    """Enter, then let the market come to the order. A mid-priced limit never
    fills on the spot: the natural credit sits below it by half the spread."""
    monitor.enter(conn, f.decision(), db.get_settings(conn), svc, NOW)
    market.set(short=(2.00, 2.10))
    monitor.step(conn, db.get_settings(conn), svc, NOW + dt.timedelta(minutes=1))
    return db.list_live_trades(conn, account=ACCOUNT)[0]


def test_a_mid_priced_entry_does_not_fill_on_the_spot(desk):
    """Entering at mid and filling at once would flatter every paper result."""
    conn, broker, market, svc = desk
    market.set(short=(2.00, 2.10))
    monitor.enter(conn, f.decision(), db.get_settings(conn), svc, NOW)
    monitor.step(conn, db.get_settings(conn), svc, NOW)
    assert db.list_live_trades(conn, account=ACCOUNT)[0]["state"] == "entering"


def test_a_paper_trade_never_lands_in_the_live_book(desk):
    conn, broker, market, svc = desk
    monitor.enter(conn, f.decision(), db.get_settings(conn), svc, NOW)
    assert db.list_live_trades(conn, account="live") == []
    assert len(db.list_live_trades(conn, account="paper")) == 1


def test_the_simulated_position_reconciles_against_the_bot_record(desk):
    """recover() compares the broker's positions with the book; on paper the two
    must agree or the monitor would pause itself at startup."""
    conn, broker, market, svc = desk
    open_a_spread(conn, market, svc)

    assert sorted(p["code"] for p in broker.positions()) == sorted([f.SHORT, f.LONG])
    assert monitor.recover(conn, svc, NOW + dt.timedelta(minutes=2)) == []


def test_buying_power_reflects_the_open_paper_spread(desk):
    conn, broker, market, svc = desk
    start = db.get_settings(conn)["paper_starting_cash"]
    open_a_spread(conn, market, svc)
    assert broker.buying_power() < start
