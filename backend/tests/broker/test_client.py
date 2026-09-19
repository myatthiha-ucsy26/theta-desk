import pandas as pd
import pytest
from futu import ModifyOrderOp, TimeInForce, TrdEnv, TrdSide

from theta.broker import client as broker
from theta.broker.client import Broker, BrokerError


class FakeCtx:
    def __init__(self):
        self.calls = []
        self.unlock_result = (0, None)
        self.place_result = (0, pd.DataFrame([{"order_id": "123"}]))
        self.orders = pd.DataFrame(columns=["order_id", "order_status", "price", "dealt_qty",
                                            "dealt_avg_price", "remark", "last_err_msg"])
        self.history = self.orders
        self.pos = pd.DataFrame(columns=["code", "qty", "position_side"])

    def unlock_trade(self, **kw):
        self.calls.append(("unlock_trade", kw))
        return self.unlock_result

    def place_combo_order(self, legs, price, qty, **kw):
        self.calls.append(("place_combo_order", legs, price, qty, kw))
        return self.place_result

    def modify_order(self, op, order_id, qty, price, **kw):
        self.calls.append(("modify_order", op, order_id, qty, price, kw))
        return (0, None)

    def order_list_query(self, **kw):
        self.calls.append(("order_list_query", kw))
        df = self.orders
        if kw.get("order_id"):
            df = df[df["order_id"] == kw["order_id"]]
        return (0, df)

    def history_order_list_query(self, **kw):
        return (0, self.history)

    def position_list_query(self, **kw):
        return (0, self.pos)

    def accinfo_query(self, **kw):
        return (0, pd.DataFrame([{"power": 1018.3}]))

    def order_fee_query(self, **kw):
        return (0, pd.DataFrame([{"order_id": "123", "fee_amount": 1.25}, {"order_id": "123", "fee_amount": 0.5}]))


@pytest.fixture
def ctx():
    return FakeCtx()


def broker(ctx):
    return Broker(ctx_fn=lambda: ctx, password="pw")


def test_opening_legs_buy_long_and_sell_short(ctx):
    long_leg, short_leg = Broker.legs("S", "L", opening=True)
    assert (long_leg.code, long_leg.trd_side, long_leg.qty_ratio) == ("L", TrdSide.BUY, 1)
    assert (short_leg.code, short_leg.trd_side) == ("S", TrdSide.SELL)


def test_closing_legs_sell_long_and_buy_back_short(ctx):
    long_leg, short_leg = Broker.legs("S", "L", opening=False)
    assert (long_leg.trd_side, short_leg.trd_side) == (TrdSide.SELL, TrdSide.BUY)


def test_legs_only_ever_send_buy_or_sell():
    """SELL_SHORT / BUY_BACK are response-only values. OpenD rejects them on a place."""
    for opening in (True, False):
        sides = {leg.trd_side for leg in Broker.legs("S", "L", opening=opening)}
        assert sides <= {TrdSide.BUY, TrdSide.SELL}, sides


def test_place_spread_unlocks_once_and_sends_a_real_combo(ctx):
    b = broker(ctx)
    assert b.place_spread("S", "L", True, 0.604, 1, "csbot:t1") == "123"
    b.place_spread("S", "L", False, 0.30, 1, "csbot:t1", gtc=True)
    assert [c[0] for c in ctx.calls].count("unlock_trade") == 1
    _, legs, price, qty, kw = ctx.calls[1]
    assert (price, qty, kw["trd_env"], kw["remark"], kw["time_in_force"]) == (0.6, 1, TrdEnv.REAL, "csbot:t1", TimeInForce.DAY)
    assert ctx.calls[2][4]["time_in_force"] == TimeInForce.GTC


def test_place_spread_refuses_non_bot_remark_and_non_positive_price(ctx):
    b = broker(ctx)
    with pytest.raises(BrokerError, match="remark"):
        b.place_spread("S", "L", True, 0.6, 1, "manual")
    with pytest.raises(BrokerError, match="positive"):
        b.place_spread("S", "L", True, 0.0, 1, "csbot:t1")
    assert not any(c[0] == "place_combo_order" for c in ctx.calls)


def test_opend_error_passes_through(ctx):
    ctx.place_result = (-1, "insufficient buying power")
    with pytest.raises(BrokerError, match="place: insufficient buying power"):
        broker(ctx).place_spread("S", "L", True, 0.6, 1, "csbot:t1")


GUI_DISABLED = ("Please use the Unlock button in the top-right corner of the OpenD page to unlock trading. "
                "The GUI version of OpenD has disabled the unlock interface.")


def test_unlock_failure_passes_through(ctx):
    ctx.unlock_result = (-1, "wrong password")
    with pytest.raises(BrokerError, match="^unlock: wrong password"):
        broker(ctx).unlock()


def test_gui_opend_unlock_is_accepted(ctx):
    ctx.unlock_result = (-1, GUI_DISABLED)
    b = broker(ctx)
    assert b.unlock() == "unlocked in OpenD"
    assert b.place_spread("S", "L", True, 0.6, 1, "csbot:t1") == "123"


def test_no_password_leaves_unlock_to_opend(ctx, monkeypatch):
    monkeypatch.delenv("MOOMOO_TRADE_PASSWORD", raising=False)
    b = Broker(ctx_fn=lambda: ctx)
    assert b.unlock() == "unlocked in OpenD"
    b.place_spread("S", "L", True, 0.6, 1, "csbot:t1")
    assert not any(c[0] == "unlock_trade" for c in ctx.calls)


def test_locked_account_errors_are_unlock_errors(ctx):
    ctx.place_result = (-1, "Trade is locked. Please unlock trading first.")
    with pytest.raises(BrokerError, match="^unlock: Trade is locked"):
        broker(ctx).place_spread("S", "L", True, 0.6, 1, "csbot:t1")


def test_cancel_and_reprice_use_modify_order(ctx):
    b = broker(ctx)
    b.cancel("123")
    b.reprice("123", 0.551, 1)
    mods = [c for c in ctx.calls if c[0] == "modify_order"]
    assert (mods[0][1], mods[0][2], mods[0][5]["trd_env"]) == (ModifyOrderOp.CANCEL, "123", TrdEnv.REAL)
    assert (mods[1][1], mods[1][4]) == (ModifyOrderOp.NORMAL, 0.55)


def test_order_reads_today_then_history(ctx):
    row = {"order_id": "9", "order_status": "FILLED_ALL", "price": 0.3, "dealt_qty": 1.0,
           "dealt_avg_price": 0.29, "remark": "csbot:t1", "last_err_msg": ""}
    ctx.history = pd.DataFrame([row])
    assert broker(ctx).order("9") == {"order_id": "9", "status": "FILLED_ALL", "price": 0.3, "dealt_qty": 1.0,
                                      "dealt_avg_price": 0.29, "remark": "csbot:t1", "error": ""}
    with pytest.raises(BrokerError, match="not found"):
        broker(ctx).order("404")


def test_open_bot_orders_only_tagged_working_orders(ctx):
    base = {"price": 1.0, "dealt_qty": 0, "dealt_avg_price": 0, "last_err_msg": ""}
    ctx.orders = pd.DataFrame([
        {**base, "order_id": "1", "order_status": "SUBMITTED", "remark": "csbot:t1"},
        {**base, "order_id": "2", "order_status": "SUBMITTED", "remark": ""},
        {**base, "order_id": "3", "order_status": "CANCELLED_ALL", "remark": "csbot:t2"},
    ])
    assert broker(ctx).open_bot_orders() == [{"order_id": "1", "remark": "csbot:t1", "status": "SUBMITTED"}]


def test_positions_skip_closed_rows_and_sign_shorts(ctx):
    ctx.pos = pd.DataFrame([
        {"code": "S", "qty": -1.0, "position_side": "SHORT"},
        {"code": "L", "qty": 1.0, "position_side": "LONG"},
        {"code": "OLD", "qty": 0.0, "position_side": "LONG"},
    ])
    assert broker(ctx).positions() == [{"code": "S", "qty": -1.0}, {"code": "L", "qty": 1.0}]


def test_buying_power_and_fees(ctx):
    b = broker(ctx)
    assert b.buying_power() == 1018.3
    assert b.fees("123") == 1.75
