"""Carries out live autotrade decisions: entries from the engine cycle, exits from a
60-second loop. Rules live in autotrade; the only order code is in broker.

Services (injected, so everything is testable offline):
  broker   broker.Broker
  quotes   fn(codes) -> {code: {"bid", "ask"}}
  legs     fn(ticker, expiry, side, spot) -> option legs with code/bid/ask/delta
  spot     fn(ticker) -> float
  ai_exit  fn(trade, spot, mid_debit) -> (EXIT | HOLD | UNAVAILABLE, reason)
  send     fn(html message) -> (ok, error)
"""
import datetime as dt
import html
import threading
import uuid

from theta.engine import autotrade as at
from theta import strategy as cc
from theta.storage import db
from theta.engine import scan
from theta.broker.client import DEAD, FILLED, BrokerError, REMARK_PREFIX


def iso(t):
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def account_of(conn):
    """Which account the bot is trading. Read rather than passed, so a control
    called straight from an endpoint cannot act on the wrong book."""
    return db.get_settings(conn)["account_mode"]


def pause(conn, services, reason, now):
    """Stop new entries and say why. Exits keep running. Idempotent."""
    if db.get_settings(conn)["bot_paused"]:
        return
    db.put_settings(conn, {"bot_paused": True, "bot_pause_reason": reason})
    db.log_order_event(conn, iso(now), "pause", "paused", reason=reason)
    services["send"](f"🛑 <b>Bot paused</b>\n{html.escape(reason)}")


def resume(conn, services, now):
    """Allow new entries again. Idempotent."""
    if not db.get_settings(conn)["bot_paused"]:
        return
    db.put_settings(conn, {"bot_paused": False, "bot_pause_reason": ""})
    db.log_order_event(conn, iso(now), "resume", "resumed")
    services["send"]("▶️ <b>Bot resumed</b>\nNew entries are allowed again.")


def on_broker_error(conn, services, now, error, action, trade_id=None, price=None):
    db.log_order_event(conn, iso(now), action, "rejected", trade_id=trade_id, price=price, reason=str(error))
    if str(error).startswith("unlock:"):
        pause(conn, services, f"trading is locked, press the Unlock button in OpenD ({error})", now)
    elif db.consecutive_rejections(conn) >= at.MAX_REJECTIONS:
        pause(conn, services, f"{at.MAX_REJECTIONS} orders rejected in a row; last: {error}", now)


def enter(conn, decision, settings, services, now):
    """Try to open a live spread for a decision that passed every engine gate."""
    ticker, signal, direction = decision["ticker"], decision["signal"], decision["direction"]
    # A pause or switch-off saved after `settings` was read still wins (Stop trading mid-cycle).
    latest = db.get_settings(conn)
    if latest["mode"] != "auto":
        settings = {**settings, "mode": latest["mode"]}
    if latest["bot_paused"]:
        settings = {**settings, "bot_paused": True, "bot_pause_reason": latest["bot_pause_reason"]}
    if settings["mode"] != "auto":
        return "skipped: auto mode is off"
    side = "put" if direction == cc.SELL_PUT else "call"
    try:
        legs = services["legs"](ticker, signal["expiration"], side, signal["spot"])
    except Exception as e:
        return f"skipped: option chain unavailable: {e}"
    pair = at.five_wide(legs, direction)
    if pair is None:
        return "skipped: no 5-wide spread at the target delta"
    short, long = pair["short"], pair["long"]
    try:
        q = services["quotes"]([short["code"], long["code"]])
        buying_power = services["broker"].buying_power()
    except Exception as e:
        return f"skipped: {e}"
    prices = at.spread_prices(q[short["code"]], q[long["code"]])

    account = latest["account_mode"]
    active = db.list_live_trades(conn, db.ACTIVE_STATES, account=account)
    day = iso(at.day_start(now))
    block = at.entry_block({
        "mode": settings["mode"], "paused": settings["bot_paused"],
        "pause_reason": settings["bot_pause_reason"], "now": now,
        "day_pnl": db.bot_net_pnl(conn, since_ts=day, account=account),
        "open_count": len(active),
        "week_entries": db.bot_entries_since(conn, iso(at.week_start(now)), account=account),
        "net_pnl": db.bot_net_pnl(conn, account=account),
        "ticker_active": any(t["ticker"] == ticker for t in active),
        "cancelled_today": db.cancelled_since(conn, ticker, day, account=account) > 0,
        "buying_power": buying_power,
        "max_loss": at.max_loss(prices["mid"]),
    })
    if block:
        return f"skipped: {block}"
    block = at.price_block(round(short["price"] - long["price"], 2), prices["mid"], settings["min_credit"])
    if block:
        return f"skipped: {block}"

    trade_id = uuid.uuid4().hex[:12]
    ts = iso(now)
    try:
        order_id = services["broker"].place_spread(short["code"], long["code"], True, prices["mid"],
                                                   at.CONTRACTS, f"{REMARK_PREFIX}{trade_id}")
    except BrokerError as e:
        on_broker_error(conn, services, now, e, "place_entry", trade_id, prices["mid"])
        return f"rejected: {e}"
    db.insert_live_trade(conn, {
        "id": trade_id, "account": account, "ticker": ticker, "direction": direction, "expiry": signal["expiration"],
        "short_code": short["code"], "long_code": long["code"],
        "short_strike": short["strike"], "long_strike": long["strike"],
        "width": at.WIDTH, "contracts": at.CONTRACTS, "planned_credit": prices["mid"],
        "state": "entering", "entry_order_id": order_id, "entry_price": prices["mid"],
        "ai_reason": decision.get("ai_reason"), "opened_at": ts,
    })
    db.log_order_event(conn, ts, "place_entry", "sent", trade_id, order_id, prices["mid"])
    return f"entry sent: {ticker} {short['strike']:g}/{long['strike']:g} at ${prices['mid']:.2f} credit"


# ---------------- monitor pass ----------------

EXIT_LABELS = {"tp": "take profit", "sl": "stop loss", "ai": "AI exit", "expiry": "expiry day", "manual": "closed by you"}


def _spread_name(t):
    side = "Bull Put" if t["direction"] == cc.SELL_PUT else "Bear Call"
    return f"{t['ticker']} {side} {t['short_strike']:g}/{t['long_strike']:g}"


def _prices(t, services):
    q = services["quotes"]([t["short_code"], t["long_code"]])
    return at.spread_prices(q[t["short_code"]], q[t["long_code"]])


def step(conn, settings, services, now):
    """One pass over every active bot trade. Every trade is tried; errors are raised together."""
    handlers = {"entering": _step_entering, "open": _step_open, "closing": _step_closing}
    errors = []
    for t in db.list_live_trades(conn, db.ACTIVE_STATES, account=settings["account_mode"]):
        try:
            handlers[t["state"]](conn, t, settings, services, now)
        except Exception as e:
            errors.append(f"{t['ticker']} ({t['state']}): {e}")
    if errors:
        raise RuntimeError("; ".join(errors))


def _reprice(conn, t, order_id, price, opening, services, now):
    """Move a working order to price. Returns the order id to track, or None if it filled.

    If moomoo will not modify the combo, cancel it and send a fresh one -- unless the
    cancel reveals a fill, in which case the next pass books it.
    """
    b = services["broker"]
    try:
        b.reprice(order_id, price, t["contracts"])
        db.log_order_event(conn, iso(now), "reprice", "sent", t["id"], order_id, price)
        return order_id
    except BrokerError as e:
        db.log_order_event(conn, iso(now), "reprice", "failed", t["id"], order_id, price, str(e))
    try:
        b.cancel(order_id)
    except BrokerError:
        pass
    o = b.order(order_id)
    if o["status"] == FILLED:
        return None
    if o["status"] not in DEAD:
        return order_id   # cancel still pending; decide next pass
    action = "place_entry" if opening else "place_close"
    try:
        new_id = b.place_spread(t["short_code"], t["long_code"], opening, price, t["contracts"],
                                f"{REMARK_PREFIX}{t['id']}")
    except BrokerError as e:
        on_broker_error(conn, services, now, e, action, t["id"], price)
        return order_id   # dead; the next pass handles it
    db.log_order_event(conn, iso(now), action, "sent", t["id"], new_id, price)
    return new_id


def _step_entering(conn, t, settings, services, now):
    b = services["broker"]
    o = b.order(t["entry_order_id"])
    if o["status"] == FILLED:
        return _on_entry_filled(conn, t, o, settings, services, now)
    if o["status"] in DEAD:
        db.update_live_trade(conn, t["id"], state="entry_cancelled")
        db.log_order_event(conn, iso(now), "entry_dead", o["status"], t["id"], o["order_id"], reason=o["error"])
        return
    if settings["bot_paused"] or t["entry_reprices"] >= at.MAX_ENTRY_REPRICES:
        return _cancel_entry(conn, t, settings, services, now)
    new_price = at.next_entry_price(t["entry_price"], _prices(t, services)["natural_credit"])
    if new_price is None:
        return _cancel_entry(conn, t, settings, services, now)
    order_id = _reprice(conn, t, t["entry_order_id"], new_price, True, services, now)
    if order_id is not None:
        db.update_live_trade(conn, t["id"], entry_order_id=order_id, entry_price=new_price,
                                entry_reprices=t["entry_reprices"] + 1)


def _cancel_entry(conn, t, settings, services, now):
    b = services["broker"]
    try:
        b.cancel(t["entry_order_id"])
    except BrokerError as e:
        db.log_order_event(conn, iso(now), "cancel_entry", "failed", t["id"], t["entry_order_id"], reason=str(e))
    o = b.order(t["entry_order_id"])
    if o["status"] == FILLED:
        return _on_entry_filled(conn, t, o, settings, services, now)
    if o["status"] in DEAD:
        db.update_live_trade(conn, t["id"], state="entry_cancelled")
        db.log_order_event(conn, iso(now), "cancel_entry", "cancelled", t["id"], o["order_id"],
                              reason="not filled at an acceptable credit")


def _on_entry_filled(conn, t, o, settings, services, now):
    credit = o["dealt_avg_price"] or t["entry_price"]
    fees = services["broker"].fees(o["order_id"])
    db.update_live_trade(conn, t["id"], state="open", credit=credit, fees=fees, filled_at=iso(now), sl_hits=0)
    db.log_order_event(conn, iso(now), "entry_filled", "filled", t["id"], o["order_id"], credit)
    t = db.get_live_trade(conn, t["id"])
    _place_tp(conn, t, settings, services, now)
    tp = at.tp_price(credit, settings["tp_pct"])
    sl = round(credit * (1 + settings["sl_multiple"]), 2)
    services["send"]("\n".join([
        f"🤖 <b>Opened {html.escape(_spread_name(t))}</b> · expires {t['expiry']}",
        f"💰 Credit ${credit * 100:,.0f} · max loss ${at.max_loss(credit, t['contracts']):,.0f}",
        f"🎯 TP buy back at ${tp:.2f} · 🛑 SL at ${sl:.2f}",
        f"🧠 AI: {html.escape(t['ai_reason'] or '')}",
    ]))


def _place_tp(conn, t, settings, services, now):
    price = at.tp_price(t["credit"], settings["tp_pct"])
    for gtc in (True, False):
        try:
            oid = services["broker"].place_spread(t["short_code"], t["long_code"], False, price,
                                                  t["contracts"], f"{REMARK_PREFIX}{t['id']}", gtc=gtc)
        except BrokerError as e:
            on_broker_error(conn, services, now, e, "place_tp", t["id"], price)
            continue
        db.update_live_trade(conn, t["id"], tp_order_id=oid, tp_tif="GTC" if gtc else "DAY")
        db.log_order_event(conn, iso(now), "place_tp", "sent", t["id"], oid, price)
        return
    db.update_live_trade(conn, t["id"], tp_order_id=None)
    services["send"](f"⚠️ <b>{html.escape(_spread_name(t))}</b>: take-profit order could not be placed. "
                     "Stop loss is still watched while the app runs.")


def _step_open(conn, t, settings, services, now):
    b = services["broker"]
    if t["tp_order_id"]:
        o = b.order(t["tp_order_id"])
        if o["status"] == FILLED:
            return _book_close(conn, t, o, "tp", services, now)
        if o["status"] in DEAD:
            db.log_order_event(conn, iso(now), "tp_dead", o["status"], t["id"], o["order_id"])
            _place_tp(conn, t, settings, services, now)
            t = db.get_live_trade(conn, t["id"])
    prices = _prices(t, services)
    if at.expiry_close_due(t["expiry"], now):
        return begin_close(conn, t, "expiry", prices, services, now)
    if at.sl_breached(prices["mid"], t["credit"], settings["sl_multiple"]):
        hits = t["sl_hits"] + 1
        db.update_live_trade(conn, t["id"], sl_hits=hits)
        if hits >= at.SL_CONFIRMATIONS:
            return begin_close(conn, db.get_live_trade(conn, t["id"]), "sl", prices, services, now)
    elif t["sl_hits"]:
        db.update_live_trade(conn, t["id"], sl_hits=0)
    if at.ai_check_due(t["last_ai_check"], now):
        verdict, reason = services["ai_exit"](t, services["spot"](t["ticker"]), prices["mid"])
        db.update_live_trade(conn, t["id"], last_ai_check=iso(now))
        db.log_order_event(conn, iso(now), "ai_check", verdict, t["id"], reason=reason)
        if verdict == "EXIT":
            return begin_close(conn, db.get_live_trade(conn, t["id"]), "ai", prices, services, now, why=reason)


def begin_close(conn, t, reason, prices, services, now, why=None):
    """Cancel the take profit, then buy the spread back at mid. A TP that filled meanwhile wins."""
    b = services["broker"]
    if t["tp_order_id"]:
        try:
            b.cancel(t["tp_order_id"])
        except BrokerError as e:
            db.log_order_event(conn, iso(now), "cancel_tp", "failed", t["id"], t["tp_order_id"], reason=str(e))
        o = b.order(t["tp_order_id"])
        if o["status"] == FILLED:
            return _book_close(conn, t, o, "tp", services, now)
        if o["status"] not in DEAD:
            return   # cancel pending; the trigger fires again next pass
        db.update_live_trade(conn, t["id"], tp_order_id=None)
    price = max(0.01, prices["mid"])
    try:
        oid = b.place_spread(t["short_code"], t["long_code"], False, price, t["contracts"], f"{REMARK_PREFIX}{t['id']}")
    except BrokerError as e:
        on_broker_error(conn, services, now, e, "place_close", t["id"], price)
        return
    db.update_live_trade(conn, t["id"], state="closing", close_order_id=oid, close_price=price,
                            close_reprices=0, exit_reason=reason)
    db.log_order_event(conn, iso(now), "place_close", "sent", t["id"], oid, price, why or EXIT_LABELS[reason])
    lines = [f"⚠️ <b>Closing {html.escape(_spread_name(t))}</b> ({EXIT_LABELS[reason]}) at ${price:.2f}"]
    if why:
        lines.append(f"🧠 {html.escape(why)}")
    services["send"]("\n".join(lines))


def _step_closing(conn, t, settings, services, now):
    b = services["broker"]
    o = b.order(t["close_order_id"])
    if o["status"] == FILLED:
        return _book_close(conn, t, o, t["exit_reason"], services, now)
    price = at.next_close_price(t["close_price"])
    if o["status"] in DEAD:
        try:
            oid = b.place_spread(t["short_code"], t["long_code"], False, price, t["contracts"], f"{REMARK_PREFIX}{t['id']}")
        except BrokerError as e:
            return on_broker_error(conn, services, now, e, "place_close", t["id"], price)
        db.log_order_event(conn, iso(now), "place_close", "sent", t["id"], oid, price)
    else:
        oid = _reprice(conn, t, t["close_order_id"], price, False, services, now)
        if oid is None:
            return
    reprices = t["close_reprices"] + 1
    db.update_live_trade(conn, t["id"], close_order_id=oid, close_price=price, close_reprices=reprices)
    if reprices == at.CLOSE_ALERT_AFTER:
        services["send"](f"⚠️ <b>{html.escape(_spread_name(t))}</b> still not filled after "
                         f"{reprices} raises; now bidding ${price:.2f}")


def _book_close(conn, t, o, reason, services, now):
    debit = o["dealt_avg_price"] or o["price"]
    fees = round(t["fees"] + services["broker"].fees(o["order_id"]), 2)
    pnl = at.realised_pnl(t["credit"], debit, t["contracts"], fees)
    db.update_live_trade(conn, t["id"], state="closed", close_debit=debit, fees=fees, pnl=pnl,
                            exit_reason=reason, closed_at=iso(now))
    db.log_order_event(conn, iso(now), "closed", "filled", t["id"], o["order_id"], debit, EXIT_LABELS[reason])
    icon = "✅" if pnl > 0 else "🔻"
    services["send"](f"{icon} <b>Closed {html.escape(_spread_name(t))}</b> · {EXIT_LABELS[reason]}\n"
                     f"P&L ${pnl:+,.2f} (fees ${fees:.2f})")


# ---------------- recovery, controls, loop ----------------

def recover(conn, services, now):
    """Problems between moomoo's orders/positions and the bot's records."""
    b = services["broker"]
    account = account_of(conn)
    known = {t["id"] for t in db.list_live_trades(conn, account=account)}
    problems = [f"unknown bot order {o['order_id']} ({o['remark']})"
                for o in b.open_bot_orders() if o["remark"][len(REMARK_PREFIX):] not in known]
    problems += at.reconcile(db.list_live_trades(conn, ("open",), account=account),
                             b.positions(), now)
    return problems


def stop_trading(conn, services, now):
    """Block new entries and cancel working entry orders. Open spreads keep TP and SL."""
    pause(conn, services, "stopped by you", now)
    for t in db.list_live_trades(conn, ("entering",), account=account_of(conn)):
        try:
            services["broker"].cancel(t["entry_order_id"])
            db.log_order_event(conn, iso(now), "cancel_entry", "sent", t["id"], t["entry_order_id"], reason="stopped by you")
        except BrokerError as e:
            db.log_order_event(conn, iso(now), "cancel_entry", "failed", t["id"], t["entry_order_id"], reason=str(e))


def close_all(conn, services, now):
    """Stop trading, then close every open bot spread the same way a stop loss does."""
    stop_trading(conn, services, now)
    n = 0
    for t in db.list_live_trades(conn, ("open",), account=account_of(conn)):
        begin_close(conn, t, "manual", _prices(t, services), services, now)
        n += 1
    return n


class Monitor:
    """Runs step() every `interval` seconds in a background thread."""

    def __init__(self, db_path, services, now_fn=None, interval=60):
        self.db_path = db_path
        self.services = services
        self.now_fn = now_fn or (lambda: dt.datetime.now(dt.timezone.utc))
        self.interval = interval
        self.status = {"state": "stopped", "last_ok": None, "last_error": None}
        self._recovered = False
        self._mismatches = 0
        self._alerted = False
        self._started = None
        self._stop = threading.Event()
        self._thread = None

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def tick(self):
        conn = db.connect(self.db_path)
        now = self.now_fn()
        self._started = self._started or now
        active = []
        try:
            db.init(conn)
            settings = db.get_settings(conn)
            account = settings["account_mode"]
            active = db.list_live_trades(conn, db.ACTIVE_STATES, account=account)
            if not self._recovered:
                problems = recover(conn, self.services, now)
                self._recovered = True
                if problems:
                    pause(conn, self.services, "startup check: " + "; ".join(problems), now)
            if not active:
                self._ok("idle", now)
                return
            if not scan.market_open(now):
                self._ok("market closed", now)
                return
            step(conn, settings, self.services, now)
            problems = at.reconcile(db.list_live_trades(conn, ("open",), account=account),
                                    self.services["broker"].positions(), now)
            self._mismatches = self._mismatches + 1 if problems else 0
            if self._mismatches >= at.MISMATCH_CONFIRMATIONS:
                pause(conn, self.services, "position mismatch: " + "; ".join(problems), now)
            self._ok("watching", now)
        except Exception as e:
            self.status.update(state="error", last_error=str(e))
            since = dt.datetime.fromisoformat(self.status["last_ok"]) if self.status["last_ok"] else self._started
            if active and not self._alerted and now - since >= at.STALL_ALERT:
                self._alerted = True
                self.services["send"](f"🚨 <b>Stop loss is NOT being watched</b>\n{html.escape(str(e))}")
        finally:
            conn.close()

    def _ok(self, state, now):
        self.status.update(state=state, last_ok=iso(now), last_error=None)
        self._alerted = False

    def _loop(self):
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(self.interval)
        self.status["state"] = "stopped"

    def start(self):
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="cs-monitor", daemon=True)
        self._thread.start()

    def stop(self, timeout=10):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
