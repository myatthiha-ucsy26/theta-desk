"""A broker that simulates fills instead of sending orders.

Implements the same interface as broker.client.Broker, so the engine, the
monitor and the autotrade rules run against it unchanged. Nothing here reaches
OpenD except to read quotes.

An order does not fill because it was placed. It fills when the market is
actually showing a price that supports its limit:

    opening (selling the spread)   fills when the natural credit >= the limit
    closing (buying it back)       fills when the natural debit  <= the limit

Otherwise it stays working, and the bot's own reprice, timeout and cancel logic
has to earn the fill. That is the point of paper mode: those paths are the ones
most likely to be wrong with real money, and a broker that always filled would
never exercise them. It also keeps the results honest, because no fill happens
at a price the market was not showing.

Orders live in the database rather than in memory: the monitor polls across
ticks, and the process restarts.
"""
import uuid

from theta.broker.client import DEAD, FILLED, REMARK_PREFIX, BrokerError
from theta.engine import autotrade as at
from theta.storage import db

SUBMITTED = "SUBMITTED"
CANCELLED = "CANCELLED_ALL"
CONTRACT_MULTIPLIER = 100


class PaperBroker:
    """A simulated account. `quotes` and `now` are injected so tests drive both.

    `conn_fn` returns a fresh connection; the broker opens one per call and
    closes it, matching how every other caller in this project uses the database.
    """

    def __init__(self, conn_fn, quotes, now, settings=None):
        self._conn_fn = conn_fn
        self._quotes = quotes
        self._now = now
        self._settings = settings or (lambda: db.DEFAULT_SETTINGS)

    # ---------------- helpers ----------------

    def _setting(self, key):
        return self._settings()[key]

    def _prices(self, short_code, long_code):
        """What the market is showing for this spread, or None when it is unquotable."""
        try:
            q = self._quotes([short_code, long_code])
            return at.spread_prices(q[short_code], q[long_code])
        except Exception:
            return None

    def _fee(self, qty):
        """Charged per leg per contract. A spread is two legs."""
        return round(self._setting("paper_fee_per_contract") * qty * 2, 2)

    def _fills_at(self, order, prices):
        """The price this order fills at now, or None if the market does not support it."""
        if prices is None:
            return None
        limit = order["price"]
        if order["opening"]:
            # Selling the spread: we need at least our limit in credit.
            return limit if prices["natural_credit"] >= limit else None
        # Buying it back: we will not pay more than our limit.
        return limit if prices["natural_debit"] <= limit else None

    def _settle(self, conn, order):
        """Fill a working order if the market now supports it. Returns the row."""
        if order["status"] != SUBMITTED:
            return order
        fill = self._fills_at(order, self._prices(order["short_code"], order["long_code"]))
        if fill is None:
            return order
        conn.execute(
            "UPDATE paper_orders SET status = ?, dealt_qty = ?, fill_price = ?, fees = ?, "
            "updated_at = ? WHERE order_id = ?",
            (FILLED, order["qty"], fill, self._fee(order["qty"]),
             self._now().isoformat(), order["order_id"]),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM paper_orders WHERE order_id = ?",
                                 (order["order_id"],)).fetchone())

    def _row(self, conn, order_id):
        row = conn.execute("SELECT * FROM paper_orders WHERE order_id = ?", (order_id,)).fetchone()
        if row is None:
            raise BrokerError(f"order {order_id} not found")
        return dict(row)

    # ---------------- the Broker interface ----------------

    def unlock(self):
        return "paper account: no unlock needed"

    def place_spread(self, short_code, long_code, opening, price, qty, remark, gtc=False):
        if price <= 0:
            raise BrokerError(f"place: price must be positive, got {price}")
        if not remark.startswith(REMARK_PREFIX):
            raise BrokerError(f"place: remark must start with {REMARK_PREFIX}")
        if self._prices(short_code, long_code) is None:
            raise BrokerError("place: no quote for the spread")

        order_id = f"paper-{uuid.uuid4().hex[:10]}"
        ts = self._now().isoformat()
        conn = self._conn_fn()
        try:
            conn.execute(
                "INSERT INTO paper_orders (order_id, short_code, long_code, opening, price, qty, "
                "remark, status, placed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (order_id, short_code, long_code, int(bool(opening)), round(price, 2), qty,
                 remark, SUBMITTED, ts, ts),
            )
            conn.commit()
        finally:
            conn.close()
        return order_id

    def reprice(self, order_id, price, qty):
        conn = self._conn_fn()
        try:
            order = self._row(conn, order_id)
            if order["status"] != SUBMITTED:
                raise BrokerError(f"reprice: order {order_id} is {order['status']}")
            conn.execute(
                "UPDATE paper_orders SET price = ?, qty = ?, updated_at = ? WHERE order_id = ?",
                (round(price, 2), qty, self._now().isoformat(), order_id),
            )
            conn.commit()
        finally:
            conn.close()

    def cancel(self, order_id):
        conn = self._conn_fn()
        try:
            order = self._row(conn, order_id)
            if order["status"] == FILLED:
                raise BrokerError(f"cancel: order {order_id} already filled")
            conn.execute(
                "UPDATE paper_orders SET status = ?, updated_at = ? WHERE order_id = ?",
                (CANCELLED, self._now().isoformat(), order_id),
            )
            conn.commit()
        finally:
            conn.close()

    def order(self, order_id):
        """The order as it stands now, settling it first if the market has come to it."""
        conn = self._conn_fn()
        try:
            order = self._settle(conn, self._row(conn, order_id))
        finally:
            conn.close()
        return {
            "order_id": order["order_id"],
            "status": order["status"],
            "price": float(order["price"]),
            "dealt_qty": float(order["dealt_qty"] or 0),
            "dealt_avg_price": float(order["fill_price"] or 0),
            "remark": order["remark"],
            "error": "",
        }

    def open_bot_orders(self):
        conn = self._conn_fn()
        try:
            working = [dict(r) for r in conn.execute(
                "SELECT * FROM paper_orders WHERE status = ? ORDER BY placed_at", (SUBMITTED,))]
            working = [self._settle(conn, o) for o in working]
        finally:
            conn.close()
        return [{"order_id": o["order_id"], "remark": o["remark"], "status": o["status"]}
                for o in working
                if o["remark"].startswith(REMARK_PREFIX)
                and o["status"] != FILLED and o["status"] not in DEAD]

    def positions(self):
        """Net contracts per option code, from the fills so far.

        An opening fill is short the short leg and long the long leg; a closing
        fill unwinds both.
        """
        conn = self._conn_fn()
        try:
            rows = [dict(r) for r in conn.execute(
                "SELECT * FROM paper_orders WHERE status = ?", (FILLED,))]
        finally:
            conn.close()

        net = {}
        for o in rows:
            sign = 1 if o["opening"] else -1
            qty = float(o["dealt_qty"])
            net[o["short_code"]] = net.get(o["short_code"], 0.0) - sign * qty
            net[o["long_code"]] = net.get(o["long_code"], 0.0) + sign * qty
        return [{"code": code, "qty": qty} for code, qty in sorted(net.items()) if qty != 0]

    def buying_power(self):
        """Simulated cash, less the risk currently deployed in the paper account."""
        conn = self._conn_fn()
        try:
            open_trades = db.list_live_trades(conn, ("entering", "open", "closing"),
                                              account="paper")
            realised = db.bot_net_pnl(conn, account="paper")
        finally:
            conn.close()
        deployed = sum(at.max_loss(t["planned_credit"], t["contracts"]) for t in open_trades)
        return round(self._setting("paper_starting_cash") + realised - deployed, 2)

    def fees(self, order_id):
        conn = self._conn_fn()
        try:
            return round(float(self._row(conn, order_id)["fees"]), 2)
        finally:
            conn.close()
