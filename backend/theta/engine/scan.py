"""The scan pipeline: one ticker, one DTE, through every gate, cheapest first.

Pure: every piece of IO (quotes, price history, AI, alert history) arrives as an
injected callable in `deps`, so the whole decision path is testable offline and
the same function will serve auto mode later.

Gates, in order. The first failure stops the scan and is recorded as the stage:
  signal     strategy verdict for the selected modes is not NO_TRADE, and its
             direction (bull put / bear call) is switched on in settings
  tradeable  a spread fits (open interest floor, $500 risk cap)
  edge       pooled 5-year backtest shows positive expectancy for this cell
  risk       position count, deployed risk, one position per ticker
  ai         AI event-risk review (skipped when disabled)
  dedupe     same spread not already alerted within the cooldown
Edge, risk, AI and dedupe can each be switched off in settings; a skipped gate is
listed in "skipped". Auto mode always runs risk and AI.
A decision that clears all of them has stage "alert" and passed=True.
"""
import datetime as dt
import html
from zoneinfo import ZoneInfo

from theta import strategy as cc
from theta.engine import edge

NEW_YORK = ZoneInfo("America/New_York")
RISK_PER_TRADE = 500.0


def market_open(now_utc):
    """US regular session, Mon-Fri 09:30-16:00 New York time. Holidays are not modelled."""
    if now_utc.tzinfo is None:
        raise ValueError("market_open needs a timezone-aware datetime")
    ny = now_utc.astimezone(NEW_YORK)
    if ny.weekday() >= 5:
        return False
    return dt.time(9, 30) <= ny.time() < dt.time(16, 0)


def next_market_open(now_utc):
    """The next 9:30 AM New York session open strictly after now_utc. Holidays are not modelled."""
    ny = now_utc.astimezone(NEW_YORK)
    for days in range(0, 8):
        day = (ny + dt.timedelta(days=days)).date()
        if day.weekday() >= 5:
            continue
        candidate = dt.datetime.combine(day, dt.time(9, 30), tzinfo=NEW_YORK)
        if candidate > now_utc:
            return candidate.astimezone(dt.timezone.utc)
    raise AssertionError("unreachable: a weekday open always exists within 8 days")


def alert_key(ticker, signal):
    sp = signal["spread"]
    return f"{ticker.upper()}|{signal['direction']}|{sp['short']}|{sp['long']}|{signal['expiration']}"


def position_risk(position):
    """Dollars at risk in an open spread: (width - credit) per share."""
    return (position["width"] - position["credit"]) * 100 * position["contracts"]


def signal_risk(signal):
    """Dollars a new alert would risk, sized the same way the dashboard sizes it."""
    max_loss = signal["spread"]["max_loss"]
    contracts = max(1, int(RISK_PER_TRADE / max_loss)) if max_loss > 0 else 1
    return max_loss * contracts


def risk_check(ticker, signal, open_positions, settings):
    tk = ticker.upper()
    if any(p["ticker"].upper() == tk for p in open_positions):
        return False, f"already holding a {tk} position"
    limit = settings["max_open_positions"]
    if len(open_positions) >= limit:
        return False, f"{len(open_positions)} open positions, max {limit}"
    total = sum(position_risk(p) for p in open_positions) + signal_risk(signal)
    cap = settings["max_deployed_risk"]
    if total > cap:
        return False, f"deployed risk ${total:.0f} would exceed ${cap:.0f}"
    return True, f"deployed risk ${total:.0f} of ${cap:.0f}"


def scan_ticker(ticker, dte, settings, deps):
    """Run one ticker through every gate and return the decision record."""
    modes = list(settings["modes"])
    d = {
        "ticker": ticker.upper(), "dte": dte, "modes": modes,
        "stage": "signal", "passed": False, "direction": None, "reason": "",
        "signal": None, "edge": [], "alert_key": None, "ai_verdict": None, "ai_reason": None,
        "skipped": [],
    }
    auto = settings["mode"] == "auto"

    try:
        signal = deps["evaluate"](ticker, dte, modes)
    except Exception as e:
        d["reason"] = f"error: {e}"
        return d
    d["signal"] = signal
    d["direction"] = signal["direction"]
    agree, of = cc.agreement([signal["verdicts"][m]["direction"] for m in modes], signal["direction"])
    d["confidence"] = {"agree": agree, "of": of, "win_rate": None, "n": None}
    if signal["direction"] == cc.NO_TRADE:
        d["reason"] = "; ".join(f"{m}: {signal['verdicts'][m]['reason']}" for m in modes)
        return d
    if signal["direction"] not in settings["directions"]:
        side = edge.SIDE_NAMES[signal["direction"]]
        d["reason"] = f"{side} signal, but {side}s are switched off in settings"
        return d

    d["stage"] = "tradeable"
    if not signal.get("spread"):
        d["reason"] = "no spread fits (open interest floor / $500 risk cap)"
        return d

    d["stage"] = "edge"
    if not settings["edge_enabled"]:
        d["skipped"].append("edge")
    elif not _edge_gate(ticker, dte, signal, modes, settings, deps, d):
        return d

    d["stage"] = "risk"
    if settings["risk_enabled"] or auto:
        ok, why = risk_check(ticker, signal, deps["open_positions"], settings)
        if not ok:
            d["reason"] = why
            return d
    else:
        d["skipped"].append("risk")

    d["stage"] = "ai"
    # Live trading never skips the AI veto, and CAUTION is a no.
    if settings["ai_enabled"] or auto:
        verdict, why = deps["ai_review"](ticker, signal)
        d["ai_verdict"], d["ai_reason"] = verdict, why
        allowed = {"CONFIRM", "CAUTION"} if settings["ai_allow_caution"] and not auto else {"CONFIRM"}
        if verdict not in allowed:
            d["reason"] = f"AI {verdict}: {why}"
            return d
    else:
        d["skipped"].append("ai")

    d["stage"] = "dedupe"
    d["alert_key"] = alert_key(ticker, signal)
    if not settings["dedupe_enabled"]:
        d["skipped"].append("dedupe")
    elif deps["recently_alerted"](d["alert_key"]):
        d["reason"] = f"already alerted within {settings['alert_cooldown_hours']}h"
        return d

    d["stage"] = "alert"
    d["passed"] = True
    d["reason"] = "; ".join(d["edge"]) or "passed; skipped " + ", ".join(d["skipped"])
    return d


def _edge_gate(ticker, dte, signal, modes, settings, deps, d):
    """Backtest edge for the modes that fired. Fills d and returns True when one has edge."""
    try:
        rank = edge.rank_from_closes(deps["closes"](ticker))
    except Exception as e:
        d["reason"] = f"edge rank unavailable: {e}"
        return False
    # Only the modes that fired are checked; one of them with proven edge is enough.
    fired = [m for m in modes if signal["verdicts"][m]["direction"] == signal["direction"]]
    failures, best = [], None
    for m in fired:
        ok, why = edge.passes(deps["edge_table"], m, dte, rank,
                                 min_n=settings["edge_min_n"],
                                 min_expectancy=settings["edge_min_expectancy"],
                                 direction=signal["direction"])
        if not ok:
            failures.append(why)
            continue
        d["edge"].append(why)
        stats = edge.cell(deps["edge_table"], m, dte, rank, signal["direction"])
        if stats.get("win_rate") is not None and (best is None or stats["win_rate"] > best["win_rate"]):
            best = stats
    if not d["edge"]:
        d["reason"] = "; ".join(failures)
        return False
    if best is not None:
        d["confidence"].update(win_rate=round(best["win_rate"], 2), n=best["n"])
    return True


def _px(v):
    """A strike or price without a trailing '.0': 165 shows as $165, 652.5 as $652.5."""
    return f"{round(float(v), 2):g}"


def format_alert(decision):
    """Telegram message (HTML parse mode). Every dynamic value is escaped.

    Written for a phone: one idea per line, and money in the unit the trade is
    counted in (per contract), so credit and max loss read on the same scale.
    """
    e = lambda v: html.escape(str(v))
    s, sp = decision["signal"], decision["signal"]["spread"]
    side = "Bull Put" if decision["direction"] == cc.SELL_PUT else "Bear Call"
    why = "; ".join(s["verdicts"][m]["reason"] for m in decision["modes"]
                    if s["verdicts"][m]["direction"] == decision["direction"])
    # A mode can pass its setup and still carry a flag. The flag is what stops the
    # trade being taken on conviction, so it gets its own line rather than riding
    # along in the setup sentence.
    setup, *flags = why.split(f" — {cc.TREND_CAUTION}")
    expires = dt.date.fromisoformat(s["expiration"])
    lines = [
        f"📈 <b>{e(decision['ticker'])} · {side}</b> · {e(decision['dte'])}d → {expires:%b} {expires.day}",
        "",
        f"💵 Sell ${_px(sp['short'])} / Buy ${_px(sp['long'])}",
        f"💰 Credit ${sp['credit'] * 100:,.0f} · max loss ${sp['max_loss']:,.0f}",
        f"🎯 POP {sp['pop_pct']:.0f}% · spot ${_px(s['spot'])}",
        "",
        f"🧭 {e(setup)}",
    ]
    if flags:
        lines.append(f"⚠️ {e(cc.TREND_CAUTION)}")
    if decision["edge"]:
        lines.append(f"📊 Edge · {e('; '.join(decision['edge']))}")
    conf = decision.get("confidence")
    if conf:
        text = f"🎯 Confidence · {conf['agree']}/{conf['of']} modes agree"
        if conf["win_rate"] is not None:
            text += f" · {conf['win_rate'] * 100:.0f}% backtest win (n={conf['n']})"
        lines.append(text)
    if decision["ai_verdict"]:
        lines.append(f" AI {e(decision['ai_verdict'])} · {e(decision['ai_reason'])}")
    return "\n".join(lines)