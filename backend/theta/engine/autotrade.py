"""Live autotrade rules. Pure: no IO and no clock -- every input is passed in.

monitor carries these decisions out through broker. Spec:
docs/superpowers/specs/2026-09-17-live-autotrade-design.md
"""
import datetime as dt
import math

from theta import strategy as cc
from theta.engine import scan

NY = scan.NEW_YORK

WIDTH = 5.0
CONTRACTS = 1
MARGIN_PER_SPREAD = WIDTH * 100   # what moomoo holds per 5-wide spread; also the compounding step
DAILY_LOSS_LIMIT = WIDTH * 100
PRICE_STEP = 0.05
MAX_ENTRY_REPRICES = 5
CLOSE_ALERT_AFTER = 3
MAX_REJECTIONS = 3
SL_CONFIRMATIONS = 2
MISMATCH_CONFIRMATIONS = 2
ENTRY_MAX_SLIPPAGE = 0.10
AI_EXIT_EVERY = dt.timedelta(hours=1)
STALL_ALERT = dt.timedelta(minutes=3)
RECONCILE_GRACE = dt.timedelta(minutes=2)
OPEN_BUFFER = dt.timedelta(minutes=15)
CLOSE_BUFFER = dt.timedelta(minutes=30)
EXPIRY_CLOSE_AT = dt.time(15, 0)


def five_wide(legs, direction, target_delta=0.30):
    """The short leg nearest target delta and a long leg exactly WIDTH further out, or None."""
    if direction not in (cc.SELL_PUT, cc.SELL_CALL) or not legs:
        return None
    short = min(legs, key=lambda L: abs(abs(L["delta"]) - target_delta))
    want = short["strike"] - WIDTH if direction == cc.SELL_PUT else short["strike"] + WIDTH
    long = next((L for L in legs if abs(L["strike"] - want) < 1e-6), None)
    return {"short": short, "long": long} if long else None


def spread_prices(short_q, long_q):
    """Per-share spread prices from leg quotes. mid is fair value both to open and to close;
    natural_credit is what selling at the touch receives, natural_debit what buying back pays."""
    mid = (short_q["bid"] + short_q["ask"]) / 2 - (long_q["bid"] + long_q["ask"]) / 2
    return {
        "mid": round(mid, 2),
        "natural_credit": round(short_q["bid"] - long_q["ask"], 2),
        "natural_debit": round(short_q["ask"] - long_q["bid"], 2),
    }


def max_loss(credit, contracts=CONTRACTS):
    return round((WIDTH - credit) * 100 * contracts, 2)


def slots(net_pnl):
    """One base slot, plus one for every full MARGIN_PER_SPREAD of net realised bot profit."""
    return 1 + max(0, math.floor(net_pnl / MARGIN_PER_SPREAD))


def next_slot_at(net_pnl):
    return slots(net_pnl) * MARGIN_PER_SPREAD


def _ny_midnight(now_utc, days_back=0):
    day = now_utc.astimezone(NY).date() - dt.timedelta(days=days_back)
    return dt.datetime.combine(day, dt.time(0, 0), tzinfo=NY).astimezone(dt.timezone.utc)


def week_start(now_utc):
    return _ny_midnight(now_utc, now_utc.astimezone(NY).weekday())


def day_start(now_utc):
    return _ny_midnight(now_utc)


def in_entry_window(now_utc):
    if not scan.market_open(now_utc):
        return False
    ny = now_utc.astimezone(NY)
    open_ = dt.datetime.combine(ny.date(), dt.time(9, 30), tzinfo=NY)
    close = dt.datetime.combine(ny.date(), dt.time(16, 0), tzinfo=NY)
    return open_ + OPEN_BUFFER <= ny < close - CLOSE_BUFFER


def entry_block(state):
    """Why a new live entry is not allowed right now, or None."""
    if state["mode"] != "auto":
        return "auto mode is off"
    if state["paused"]:
        return f"bot paused: {state['pause_reason']}"
    if state["day_pnl"] <= -DAILY_LOSS_LIMIT:
        return f"daily loss ${-state['day_pnl']:.0f} reached the ${DAILY_LOSS_LIMIT:.0f} limit"
    if not in_entry_window(state["now"]):
        return "outside the entry window (15 min after the open to 30 min before the close)"
    n = slots(state["net_pnl"])
    if state["open_count"] >= n:
        return f"{state['open_count']} bot spread(s) active, {n} slot(s)"
    if state["week_entries"] >= n:
        return f"{state['week_entries']} entries this week, {n} allowed"
    if state["ticker_active"]:
        return "a bot spread on this ticker is already active"
    if state["cancelled_today"]:
        return "an entry on this ticker was already cancelled today"
    if state["buying_power"] < state["max_loss"]:
        return f"buying power ${state['buying_power']:.0f} below max loss ${state['max_loss']:.0f}"
    return None


def price_block(snapshot_credit, mid_credit, min_credit):
    if mid_credit < min_credit:
        return f"credit ${mid_credit:.2f} below minimum ${min_credit:.2f}"
    if mid_credit < snapshot_credit * (1 - ENTRY_MAX_SLIPPAGE):
        return f"credit fell to ${mid_credit:.2f} from ${snapshot_credit:.2f}"
    return None


def next_entry_price(current, natural_credit):
    """Ask PRICE_STEP less credit, never below the natural credit. None once at the floor."""
    if current <= natural_credit + 1e-9:
        return None
    return round(max(current - PRICE_STEP, natural_credit), 2)


def next_close_price(current):
    """A stop has to get out: raise the debit by PRICE_STEP, with no cap."""
    return round(current + PRICE_STEP, 2)


def tp_price(credit, tp_pct):
    return max(0.01, round(credit * (1 - tp_pct / 100), 2))


def sl_breached(mid_debit, credit, sl_multiple):
    return mid_debit >= credit * (1 + sl_multiple) - 1e-9


def expiry_close_due(expiry, now_utc):
    ny = now_utc.astimezone(NY)
    exp = dt.date.fromisoformat(expiry)
    return ny.date() > exp or (ny.date() == exp and ny.time() >= EXPIRY_CLOSE_AT)


def ai_check_due(last_check, now_utc):
    return last_check is None or now_utc - dt.datetime.fromisoformat(last_check) >= AI_EXIT_EVERY


def realised_pnl(credit, debit, contracts, fees):
    return round((credit - debit) * 100 * contracts - fees, 2)


def reconcile(trades, positions, now_utc):
    """Where the account's legs differ from what open bot spreads expect.

    An early assignment removes the short leg, so it shows up here as a missing leg.
    Trades filled within RECONCILE_GRACE are skipped: positions can lag the fill.
    """
    held = {}
    for p in positions:
        held[p["code"]] = held.get(p["code"], 0) + p["qty"]
    expected = {}
    for t in trades:
        if t["state"] != "open" or not t["filled_at"]:
            continue
        if now_utc - dt.datetime.fromisoformat(t["filled_at"]) < RECONCILE_GRACE:
            continue
        expected[t["short_code"]] = expected.get(t["short_code"], 0) - t["contracts"]
        expected[t["long_code"]] = expected.get(t["long_code"], 0) + t["contracts"]
    return [
        f"{code}: expected {qty:+g}, account holds {held.get(code, 0):+g}"
        for code, qty in expected.items()
        if held.get(code, 0) != qty
    ]
