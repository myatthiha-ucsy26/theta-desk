"""Test doubles for the live autotrade bot. Not collected by pytest (no test_ prefix)."""
import datetime as dt

from theta.storage import db as store
from theta.broker.client import BrokerError

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)  # Wed 11:00 New York

SHORT, LONG = "US.SPY260930P731000", "US.SPY260930P726000"
LEGS = [
    {"strike": 721.0, "delta": -0.18, "price": 1.60, "code": "US.SPY260930P721000", "bid": 1.59, "ask": 1.61, "oi": 900, "iv": 0.2},
    {"strike": 726.0, "delta": -0.24, "price": 2.21, "code": LONG, "bid": 2.20, "ask": 2.22, "oi": 900, "iv": 0.2},
    {"strike": 731.0, "delta": -0.30, "price": 2.81, "code": SHORT, "bid": 2.80, "ask": 2.82, "oi": 900, "iv": 0.2},
]
QUOTES = {SHORT: {"bid": 2.80, "ask": 2.82}, LONG: {"bid": 2.20, "ask": 2.22}}  # mid 0.60


class FakeBroker:
    def __init__(self):
        self.orders, self.placed, self.cancelled, self.repriced = {}, [], [], []
        self.pos = []
        self.bp = 5000.0
        self.fee = 1.0
        self.fail_place = []          # messages raised, in order, by the next place calls
        self.fail_reprice = False
        self.fill_on_cancel = set()   # order ids that turn out filled when cancelled (race)
        self._n = 0

    def place_spread(self, short_code, long_code, opening, price, qty, remark, gtc=False):
        if self.fail_place:
            raise BrokerError(self.fail_place.pop(0))
        self._n += 1
        oid = f"o{self._n}"
        self.orders[oid] = {"order_id": oid, "status": "SUBMITTED", "price": price, "dealt_qty": 0.0,
                            "dealt_avg_price": 0.0, "remark": remark, "error": ""}
        self.placed.append({"short": short_code, "long": long_code, "opening": opening, "price": price,
                            "qty": qty, "remark": remark, "gtc": gtc, "order_id": oid})
        return oid

    def fill(self, oid, price=None):
        o = self.orders[oid]
        o.update(status="FILLED_ALL", dealt_qty=1.0, dealt_avg_price=o["price"] if price is None else price)

    def reprice(self, oid, price, qty):
        if self.fail_reprice:
            raise BrokerError("reprice: modify not supported for combo orders")
        self.orders[oid]["price"] = price
        self.repriced.append((oid, price))

    def cancel(self, oid):
        self.cancelled.append(oid)
        if oid in self.fill_on_cancel:
            self.fill(oid)
        elif self.orders[oid]["status"] != "FILLED_ALL":
            self.orders[oid]["status"] = "CANCELLED_ALL"

    def order(self, oid):
        return dict(self.orders[oid])

    def open_bot_orders(self):
        return [{"order_id": o["order_id"], "remark": o["remark"], "status": o["status"]}
                for o in self.orders.values() if o["status"] == "SUBMITTED"]

    def positions(self):
        return list(self.pos)

    def buying_power(self):
        return self.bp

    def fees(self, oid):
        return self.fee

    def unlock(self):
        pass


def services(broker, **over):
    sent = []
    s = {
        "broker": broker,
        "quotes": lambda codes: {c: QUOTES[c] for c in codes},
        "legs": lambda ticker, expiry, side, spot: LEGS,
        "spot": lambda ticker: 745.0,
        "ai_exit": lambda trade, spot, mid: ("HOLD", "nothing new"),
        "send": lambda msg: (sent.append(msg), (True, None))[1],
        "sent": sent,
    }
    s.update(over)
    return s


def decision(ticker="SPY"):
    return {"ticker": ticker, "dte": 14, "direction": "SELL_PUT", "passed": True, "stage": "alert",
            "ai_verdict": "CONFIRM", "ai_reason": "no events this week",
            "signal": {"expiration": "2026-09-30", "spot": 754.5, "spread": {"credit": 1.00}}}


def db(tmp_path):
    conn = store.connect(str(tmp_path / "bot.db"))
    store.init(conn)
    # The bot fakes exercise the live path; the paper account has its own tests.
    store.put_settings(conn, {"mode": "auto", "account_mode": "live"})
    return conn
