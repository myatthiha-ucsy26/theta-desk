"""The simulated broker: fills, repricing, fees and buying power."""
import datetime as dt
import inspect

import pytest

from theta.broker import paper
from theta.broker.client import Broker, BrokerError
from theta.broker.paper import PaperBroker
from theta.storage import db

SHORT, LONG = "US.SPY260930P731000", "US.SPY260930P726000"
NOW = dt.datetime(2026, 9, 16, 15, 0, tzinfo=dt.timezone.utc)
REMARK = "csbot:t1"


class Market:
    """Leg quotes the test moves around under the broker."""

    def __init__(self, short=(0.80, 0.90), long=(0.20, 0.30)):
        self.short, self.long = short, long
        self.missing = False

    def set(self, short=None, long=None):
        self.short = short or self.short
        self.long = long or self.long

    def __call__(self, codes):
        if self.missing:
            raise RuntimeError("no quote")
        q = {SHORT: {"bid": self.short[0], "ask": self.short[1]},
             LONG: {"bid": self.long[0], "ask": self.long[1]}}
        return {c: q[c] for c in codes}


@pytest.fixture
def broker(tmp_path):
    path = str(tmp_path / "paper.db")
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"account_mode": "paper"})
    conn.close()
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

    return PaperBroker(conn_fn, market, lambda: NOW, settings), market, path


# ---------------- fills ----------------

def test_an_order_does_not_fill_just_because_it_was_placed(broker):
    """natural credit here is 0.80 - 0.30 = 0.50, short of the 0.60 asked for."""
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    assert b.order(oid)["status"] == paper.SUBMITTED
    assert b.order(oid)["dealt_qty"] == 0


def test_it_fills_once_the_market_supports_the_limit(broker):
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    market.set(short=(0.95, 1.05))        # natural credit becomes 0.65
    o = b.order(oid)
    assert o["status"] == "FILLED_ALL"
    assert (o["dealt_qty"], o["dealt_avg_price"]) == (1.0, 0.60)


def test_a_fill_never_beats_the_price_that_was_asked_for(broker):
    """Credit far better than the limit still fills at the limit, never above it."""
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.40, 1, REMARK)
    market.set(short=(2.00, 2.10))
    assert b.order(oid)["dealt_avg_price"] == 0.40


def test_repricing_is_what_gets_a_stale_order_filled(broker):
    """The bot's own reprice loop has to work for the fill; that is the point."""
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    assert b.order(oid)["status"] == paper.SUBMITTED
    b.reprice(oid, 0.50, 1)                # natural credit is 0.50
    o = b.order(oid)
    assert o["status"] == "FILLED_ALL" and o["price"] == 0.50


def test_closing_fills_only_when_the_debit_is_low_enough(broker):
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, False, 0.40, 1, REMARK)
    assert b.order(oid)["status"] == paper.SUBMITTED    # natural debit is 0.90 - 0.20 = 0.70
    market.set(short=(0.30, 0.35), long=(0.00, 0.05))   # debit becomes 0.35
    assert b.order(oid)["status"] == "FILLED_ALL"


def test_an_unquotable_spread_is_refused_rather_than_guessed(broker):
    b, market, _ = broker
    market.missing = True
    with pytest.raises(BrokerError, match="no quote"):
        b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)


def test_a_missing_quote_leaves_a_working_order_alone(broker):
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    market.missing = True
    assert b.order(oid)["status"] == paper.SUBMITTED


# ---------------- order housekeeping ----------------

def test_cancel_stops_an_order_filling_later(broker):
    b, market, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    b.cancel(oid)
    market.set(short=(2.00, 2.10))
    assert b.order(oid)["status"] == paper.CANCELLED


def test_a_filled_order_cannot_be_cancelled_or_repriced(broker):
    b, market, _ = broker
    market.set(short=(2.00, 2.10))
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    b.order(oid)
    with pytest.raises(BrokerError, match="filled"):
        b.cancel(oid)
    with pytest.raises(BrokerError):
        b.reprice(oid, 0.50, 1)


def test_open_bot_orders_lists_only_working_ones(broker):
    b, market, _ = broker
    working = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    done = b.place_spread(SHORT, LONG, True, 0.10, 1, "csbot:t2")
    assert [o["order_id"] for o in b.open_bot_orders()] == [working]
    assert b.order(done)["status"] == "FILLED_ALL"


def test_an_unknown_order_is_an_error(broker):
    b, _, _ = broker
    with pytest.raises(BrokerError, match="not found"):
        b.order("nope")


def test_a_bad_place_is_refused_the_same_way_the_real_broker_refuses_it(broker):
    b, _, _ = broker
    with pytest.raises(BrokerError, match="positive"):
        b.place_spread(SHORT, LONG, True, 0, 1, REMARK)
    with pytest.raises(BrokerError, match="csbot:"):
        b.place_spread(SHORT, LONG, True, 0.6, 1, "mine")


# ---------------- positions, fees, buying power ----------------

def test_positions_show_the_spread_then_go_flat_when_it_is_closed(broker):
    b, market, _ = broker
    market.set(short=(2.00, 2.10))
    b.order(b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK))
    assert b.positions() == [{"code": LONG, "qty": 1.0}, {"code": SHORT, "qty": -1.0}]

    market.set(short=(0.05, 0.10), long=(0.00, 0.01))
    b.order(b.place_spread(SHORT, LONG, False, 0.30, 1, REMARK))
    assert b.positions() == []


def test_fees_are_charged_per_leg_per_contract(broker):
    b, market, path = broker
    conn = db.connect(path)
    db.put_settings(conn, {"paper_fee_per_contract": 0.65})
    conn.close()
    market.set(short=(2.00, 2.10))
    oid = b.place_spread(SHORT, LONG, True, 0.60, 2, REMARK)
    b.order(oid)
    assert b.fees(oid) == pytest.approx(0.65 * 2 * 2)      # two contracts, two legs


def test_an_unfilled_order_costs_nothing(broker):
    b, _, _ = broker
    oid = b.place_spread(SHORT, LONG, True, 0.60, 1, REMARK)
    assert b.fees(oid) == 0.0


def test_buying_power_starts_at_the_configured_cash(broker):
    b, _, path = broker
    conn = db.connect(path)
    db.put_settings(conn, {"paper_starting_cash": 10000.0})
    conn.close()
    assert b.buying_power() == 10000.0


def test_buying_power_falls_by_the_risk_an_open_spread_deploys(broker):
    b, _, path = broker
    conn = db.connect(path)
    db.put_settings(conn, {"paper_starting_cash": 10000.0})
    db.insert_live_trade(conn, {
        "id": "t1", "account": "paper", "ticker": "SPY", "direction": "SELL_PUT",
        "expiry": "2026-09-30", "short_code": SHORT, "long_code": LONG,
        "short_strike": 731.0, "long_strike": 726.0, "width": 5.0, "contracts": 1,
        "planned_credit": 0.60, "state": "open", "opened_at": NOW.isoformat()})
    conn.close()
    assert b.buying_power() == 10000.0 - 440.0          # (5.00 - 0.60) * 100


def test_a_live_position_never_touches_paper_buying_power(broker):
    b, _, path = broker
    conn = db.connect(path)
    db.put_settings(conn, {"paper_starting_cash": 10000.0})
    db.insert_live_trade(conn, {
        "id": "real", "account": "live", "ticker": "SPY", "direction": "SELL_PUT",
        "expiry": "2026-09-30", "short_code": SHORT, "long_code": LONG,
        "short_strike": 731.0, "long_strike": 726.0, "width": 5.0, "contracts": 1,
        "planned_credit": 0.60, "state": "open", "opened_at": NOW.isoformat()})
    conn.close()
    assert b.buying_power() == 10000.0


# ---------------- the interface itself ----------------

def test_the_paper_broker_matches_the_real_one_method_for_method():
    """Every call the monitor makes has to exist on both, with the same signature,
    or paper mode proves nothing about live mode."""
    for name in ("place_spread", "reprice", "cancel", "order", "open_bot_orders",
                 "positions", "buying_power", "fees", "unlock"):
        real = inspect.signature(getattr(Broker, name))
        sim = inspect.signature(getattr(PaperBroker, name))
        assert list(real.parameters) == list(sim.parameters), name
