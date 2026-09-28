"""moomoo order placement for the live autotrade bot. The ONLY module that trades.

Real account only. Every order is a two-leg combo; a single leg is never sent.
Prices are always positive: opening legs [BUY long, SELL short] at price p receive
a p credit, closing legs [SELL long, BUY short] at price p pay a p debit (verified
read-only with comboorder_tradinginfo_query, 2026-09-17).

Legs are always BUY or SELL. SELL_SHORT/BUY_BACK are response-only values -- sending
one makes OpenD reject the combo with "Order side must be BUY or SELL" (2026-09-17).
"""
import os
import re

from futu import ComboLeg, Currency, ModifyOrderOp, OrderType, RET_OK, TimeInForce, TrdEnv, TrdSide

from theta.broker import account

FILLED = "FILLED_ALL"
DEAD = {"CANCELLED_ALL", "CANCELLED_PART", "FAILED", "SUBMIT_FAILED", "DISABLED",
        "DELETED", "FILL_CANCELLED", "TIMEOUT"}
REMARK_PREFIX = "csbot:"
UNLOCKED_IN_OPEND = "unlocked in OpenD"
# The GUI version of OpenD refuses API unlocks and is unlocked with its own button.
_GUI_UNLOCK_DISABLED = "disabled the unlock interface"
_LOCKED = re.compile(r"\b(un)?lock", re.IGNORECASE)


class BrokerError(RuntimeError):
    """OpenD refused or failed a trade call. The message carries OpenD's own words."""


class Broker:
    def __init__(self, ctx_fn=account.ctx, password=None):
        self._ctx_fn = ctx_fn
        self._password = password
        self._unlocked = False

    @staticmethod
    def _ok(result, what):
        ret, data = result
        if ret != RET_OK:
            raise BrokerError(f"{what}: {data}")
        return data

    def unlock(self):
        """Unlock trading for this connection. Returns how it is unlocked.

        With no password, or with the GUI version of OpenD (which refuses API unlocks),
        unlocking is left to OpenD's own Unlock button. If OpenD is locked after all, the
        first trade call fails with an "unlock:" error.
        """
        pw = self._password if self._password is not None else os.environ.get("MOOMOO_TRADE_PASSWORD", "")
        how = UNLOCKED_IN_OPEND
        if pw:
            ret, data = self._ctx_fn().unlock_trade(password=pw)
            if ret == RET_OK:
                how = "unlocked by API"
            elif _GUI_UNLOCK_DISABLED not in str(data):
                raise BrokerError(f"unlock: {data}")
        self._unlocked = True
        return how

    @classmethod
    def _trade_ok(cls, result, what):
        """Like _ok, but a locked-account refusal becomes an "unlock:" error."""
        ret, data = result
        if ret != RET_OK and _LOCKED.search(str(data)):
            raise BrokerError(f"unlock: {data}")
        return cls._ok(result, what)

    def _trading(self):
        if not self._unlocked:
            self.unlock()
        return self._ctx_fn()

    @staticmethod
    def legs(short_code, long_code, opening):
        long_leg, short_leg = ComboLeg(), ComboLeg()
        long_leg.code, long_leg.qty_ratio = long_code, 1
        short_leg.code, short_leg.qty_ratio = short_code, 1
        if opening:
            long_leg.trd_side, short_leg.trd_side = TrdSide.BUY, TrdSide.SELL
        else:
            long_leg.trd_side, short_leg.trd_side = TrdSide.SELL, TrdSide.BUY
        return [long_leg, short_leg]

    def place_spread(self, short_code, long_code, opening, price, qty, remark, gtc=False):
        if price <= 0:
            raise BrokerError(f"place: price must be positive, got {price}")
        if not remark.startswith(REMARK_PREFIX):
            raise BrokerError(f"place: remark must start with {REMARK_PREFIX}")
        data = self._trade_ok(self._trading().place_combo_order(
            self.legs(short_code, long_code, opening), round(price, 2), qty,
            order_type=OrderType.NORMAL, trd_env=TrdEnv.REAL, remark=remark,
            time_in_force=TimeInForce.GTC if gtc else TimeInForce.DAY,
        ), "place")
        return str(data["order_id"].iloc[0])

    def reprice(self, order_id, price, qty):
        self._trade_ok(self._trading().modify_order(
            ModifyOrderOp.NORMAL, order_id, qty, round(price, 2), trd_env=TrdEnv.REAL), "reprice")

    def cancel(self, order_id):
        self._trade_ok(self._trading().modify_order(
            ModifyOrderOp.CANCEL, order_id, 0, 0, trd_env=TrdEnv.REAL), "cancel")

    def order(self, order_id):
        ctx = self._ctx_fn()
        df = self._ok(ctx.order_list_query(order_id=order_id, trd_env=TrdEnv.REAL), "order")
        if len(df) == 0:
            df = self._ok(ctx.history_order_list_query(trd_env=TrdEnv.REAL), "order history")
            df = df[df["order_id"].astype(str) == str(order_id)]
        if len(df) == 0:
            raise BrokerError(f"order {order_id} not found")
        r = df.iloc[0]
        return {
            "order_id": str(r["order_id"]), "status": str(r["order_status"]), "price": float(r["price"]),
            "dealt_qty": float(r["dealt_qty"] or 0), "dealt_avg_price": float(r["dealt_avg_price"] or 0),
            "remark": str(r["remark"] or ""), "error": str(r["last_err_msg"] or ""),
        }

    def open_bot_orders(self):
        df = self._ok(self._ctx_fn().order_list_query(trd_env=TrdEnv.REAL), "orders")
        return [
            {"order_id": str(r["order_id"]), "remark": str(r["remark"]), "status": str(r["order_status"])}
            for _, r in df.iterrows()
            if str(r["remark"] or "").startswith(REMARK_PREFIX)
            and str(r["order_status"]) != FILLED and str(r["order_status"]) not in DEAD
        ]

    def positions(self):
        df = self._ok(self._ctx_fn().position_list_query(trd_env=TrdEnv.REAL), "positions")
        out = []
        for _, r in df.iterrows():
            qty = abs(float(r["qty"]))
            if qty == 0:
                continue
            out.append({"code": str(r["code"]), "qty": -qty if str(r["position_side"]) == "SHORT" else qty})
        return out

    def buying_power(self):
        df = self._ok(self._ctx_fn().accinfo_query(trd_env=TrdEnv.REAL, currency=Currency.USD), "account")
        return float(df.iloc[0]["power"])

    def fees(self, order_id):
        df = self._ok(self._ctx_fn().order_fee_query(order_id_list=[order_id], trd_env=TrdEnv.REAL), "fees")
        return round(float(df["fee_amount"].sum()), 2) if len(df) else 0.0
