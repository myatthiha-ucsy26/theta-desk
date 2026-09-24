"""Server-sent event generators.

The desk shows its working while a scan or a backtest runs, so both stream a
log line per step and then a final result. Only the narration lives here; the
computation is in theta.signals and theta.research.
"""
import datetime as dt
import json

from theta import signals
from theta import strategy as cc
from theta.engine import edge
from theta.market import data as market_data
from theta.market.pricing import estimate_iv
from theta.research.backtest import aggregate, run_backtest


def emit(event, **data):
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def evaluate_stream(ticker, dte_target, modes):
    """Generator yielding SSE events — live step log then final result."""
    try:
        # ---- DATA step ----
        yield emit("log", step="data",
                   msg=f"Fetching {signals.HISTORY_BARS} daily klines for {ticker} from OpenD…")
        kl = market_data.recent_klines(ticker, signals.HISTORY_BARS)
        highs, lows, closes = kl["high"].tolist(), kl["low"].tolist(), kl["close"].tolist()
        if len(closes) < 55:
            yield emit("abort", msg=f"Not enough price history ({len(closes)} bars, need ≥55)")
            return
        yield emit("log", step="data",
                   msg=f"Got {len(closes)} bars, latest close ${closes[-1]:.2f}")

        yield emit("log", step="data", msg="Getting live spot price…")
        spot = market_data.get_spot(ticker)
        yield emit("log", step="data", msg=f"Spot: ${spot:.2f}")

        yield emit("log", step="data", msg=f"Picking nearest expiration to {dte_target}-day target…")
        exp, dte = market_data.pick_expiration(ticker, dte_target)
        yield emit("log", step="data", msg=f"Expiration: {exp}  ({dte} DTE)")

        yield emit("log", step="data", msg="Fetching ATM implied volatility…")
        iv = market_data.atm_iv(ticker, exp, spot)
        if iv <= 0:
            yield emit("abort", msg="No ATM IV available (market closed or illiquid)")
            return
        market_data.log_iv(ticker, iv)
        rank = edge.rank_from_closes(closes)
        rank_str = (f"vol rank {rank:.2f}, 20d RV percentile over 1y" if rank is not None
                    else "too little history to rank vol")
        yield emit("log", step="data", msg=f"ATM IV: {iv * 100:.1f}%  ({rank_str})")

        # ---- CALC step ----
        yield emit("log", step="calc",
                   msg=f"Estimating realized vol (20d log-returns, annualized)…")
        rv = estimate_iv(closes, window=20, factor=1.0)
        yield emit("log", step="calc", msg=f"RV(20d): {rv * 100:.1f}%")
        ratio_str = f"{iv / rv:.2f}" if rv > 0 else "N/A"
        yield emit("log", step="calc", msg=f"IV / RV ratio: {ratio_str}")

        # ---- IND steps ----
        yield emit("log", step="ind", msg="Building indicators…")
        ind = cc.build_indicators(highs, lows, closes, iv=iv, rv=rv, iv_rank=rank)

        rsi_s = f"oversold (<35)" if ind["rsi"] < 35 else (
            f"overbought (>65)" if ind["rsi"] > 65 else f"neutral")
        yield emit("log", step="ind",
                   msg=f"RSI(14): {ind['rsi']:.1f}  —  threshold: <35 oversold, >65 overbought  →  {rsi_s}")

        pctb_s = f"oversold (<0.10)" if ind["pctb"] < 0.10 else (
            f"overbought (>0.90)" if ind["pctb"] > 0.90 else f"neutral")
        yield emit("log", step="ind",
                   msg=f"%B(20,2): {ind['pctb']:.3f}  —  threshold: <0.10 oversold, >0.90 overbought  →  {pctb_s}")

        adx_s = f"trending (>25)" if ind["adx"] > 25 else f"weak trend"
        yield emit("log", step="ind",
                   msg=f"ADX(14): {ind['adx']:.1f}  —  threshold: >25 = trending  →  {adx_s}")

        ema_n = f"bullish (EMA20 > EMA50)" if ind['ema20'] > ind['ema50'] else f"bearish (EMA20 < EMA50)"
        yield emit("log", step="ind",
                   msg=f"EMA20: ${ind['ema20']:.2f}  |  EMA50: ${ind['ema50']:.2f}  —  {ema_n}")

        yield emit("log", step="ind",
                   msg=f"Price ${ind['close']:.2f} vs EMA20 ${ind['ema20']:.2f}  —  {'**above**' if ind['close'] > ind['ema20'] else '**below**'}")
        yield emit("log", step="ind",
                   msg=f"Lower low (5d): {ind.get('is_lower_low', False)}  |  Higher high (5d): {ind.get('is_higher_high', False)}")

        # ---- VERDICT steps ----
        verdicts = {}
        yield emit("log", step="verdict", msg="── meanrev (mean reversion) ──")
        d, r = cc.verdict("meanrev", ind)
        verdicts["meanrev"] = {"direction": d, "reason": r}
        yield emit("log", step="verdict",
                   msg=f"  →  {d}  |  {r}")

        yield emit("log", step="verdict", msg="── trend (trend following) ──")
        d, r = cc.verdict("trend", ind)
        verdicts["trend"] = {"direction": d, "reason": r}
        yield emit("log", step="verdict",
                   msg=f"  →  {d}  |  {r}")

        yield emit("log", step="verdict", msg="── ivrich (IV-rich gate + mean-rev) ──")
        d, r = cc.verdict("ivrich", ind)
        verdicts["ivrich"] = {"direction": d, "reason": r}
        yield emit("log", step="verdict",
                   msg=f"  →  {d}  |  {r}")

        # ---- COMBINE step ----
        dirs = [verdicts[m]["direction"] for m in modes]
        direction = cc.combine(dirs) if len(dirs) > 1 else dirs[0]
        yield emit("log", step="combine",
                   msg=f"Modes selected: [{', '.join(modes)}]")
        yield emit("log", step="combine",
                   msg=f"Directions: [{', '.join(dirs)}]  →  combine: {direction}")

        # ---- expected move ----
        em = cc.expected_move(spot, iv, dte)
        yield emit("log", step="calc",
                   msg=f"Expected move (1 SD): ±${em:.2f}  =  ${spot:.2f} × {iv * 100:.1f}% × √({dte}/365)")

        # ---- SPREAD step ----
        spread = None
        if direction != cc.NO_TRADE:
            side = "put" if direction == cc.SELL_PUT else "call"
            yield emit("log", step="spread",
                       msg=f"Signal fired! Building {side} spread (target Δ=0.30, max risk ≤ $500, OI ≥ {signals.OI_FLOOR})…")
            legs = [L for L in market_data.fetch_legs(ticker, exp, side, spot, 0.15)
                    if L["oi"] >= signals.OI_FLOOR]
            yield emit("log", step="spread",
                       msg=f"Got {len(legs)} candidate legs with OI ≥ {signals.OI_FLOOR} in ±15% strike range")
            if legs:
                yield emit("log", step="spread",
                           msg=f"Strike range: ${min(L['strike'] for L in legs):.1f} – ${max(L['strike'] for L in legs):.1f}")
                for L in legs:
                    yield emit("log", step="spread",
                               msg=f"  strike ${L['strike']:.1f}  Δ={L['delta']:.3f}  bid/ask=${L['price']:.2f}  OI={L['oi']}")
            spread = cc.build_spread(legs, direction, target_delta=0.30, max_risk=500)
            if spread:
                yield emit("log", step="spread",
                           msg=f"Short strike: ${spread['short_strike']} (Δ={spread['short_delta']:.3f}, target was 0.30)")
                yield emit("log", step="spread",
                           msg=f"Long strike:  ${spread['long_strike']}  |  Width: ${spread['width']}")
                yield emit("log", step="spread",
                           msg=f"Credit: ${spread['credit'] * 100:.0f}  |  Max loss: ${spread['max_loss']:.0f}")
                yield emit("log", step="spread",
                           msg=f"ROI: {spread['roi'] * 100:.1f}%  |  POP: {spread['pop'] * 100:.1f}%  |  Breakeven: ${spread['breakeven']:.2f}")
            else:
                yield emit("log", step="spread",
                           msg="No long leg fits the $500 max-risk cap given the available credit — skipping")
        else:
            yield emit("log", step="spread", msg="No trade — skipping spread construction")

        # ---- build result dict (mirrors evaluate()) ----
        out = {
            "ticker": ticker.upper(), "spot": round(spot, 2), "expiration": exp, "dte": dte,
            "modes": modes, "direction": direction,
            "expected_move": round(em, 2),
            "sd1_down": round(spot - em, 2), "sd1_up": round(spot + em, 2),
            "iv_pct": round(iv * 100, 1),
            "iv_rank": (round(rank, 2) if rank is not None else None),
            "iv_rv": round(iv / rv, 2) if rv > 0 else None,
            "indicators": {
                "rsi": round(ind["rsi"], 1), "pctb": round(ind["pctb"], 2),
                "adx": round(ind["adx"], 1),
                "ema20": round(ind["ema20"], 2), "ema50": round(ind["ema50"], 2),
                "last_close": round(ind["close"], 2),
            },
            "verdicts": {m: {"direction": verdicts[m]["direction"],
                             "reason": verdicts[m]["reason"]} for m in signals.ALL_MODES},
            "spread": signals.spread_payload(spread, spot, em),
        }

        yield emit("result", data=out)

    except Exception as e:
        yield emit("abort", msg=str(e))


def backtest_stream(ticker, dte, modes, years=2):
    """Generator yielding SSE events — backtest progress then final stats."""
    try:
        yield emit("log", step="data",
                   msg=f"Fetching {years}yr daily klines for {ticker}…")
        end = dt.date.today()
        start = (end - dt.timedelta(days=years * 365)).isoformat()
        df = market_data.fetch_klines(ticker, start, end.isoformat())
        closes = df["close"].tolist()
        yield emit("log", step="data",
                   msg=f"Got {len(closes)} bars  [{start} → {end}]")

        modes_s = "+".join(modes)
        yield emit("log", step="calc",
                   msg=f"Running backtest: {modes_s}, {dte}d DTE, target Δ=0.30, max risk=$500")

        trades = run_backtest(ticker, df, modes, dte)
        yield emit("log", step="calc",
                   msg=f"Backtest complete — {len(trades)} trades")

        for i, t in enumerate(trades[-20:], 1):
            icon = "✓" if t["win"] else "✗"
            tag = "result" if t["win"] else "loss"
            dir_label = "Bull Put" if t["direction"] == "SELL_PUT" else "Bear Call"
            yield emit("log", step=tag,
                       msg=f"#{i}: {t['entry']} → {t['expiry']}  {dir_label}  ${t['short']}/${t['long']}  {t['contracts']}x  ${t['pnl']:+.0f}  {icon}")

        stats = aggregate(trades)
        if stats["n"] == 0:
            yield emit("result", data={"stats": stats, "trades": []})
            return

        pf = "∞" if stats["profit_factor"] is None else f"{stats['profit_factor']:.2f}"
        yield emit("log", step="result",
                   msg=f"✓ Done: {stats['n']} trades · {stats['win_rate']*100:.1f}% win · "
                       f"PnL ${stats['total_pnl']:+.0f} · PF {pf} · "
                       f"maxDD ${stats['max_drawdown']:.0f}")

        last_trades = [{k: (v.isoformat() if hasattr(v, "isoformat") else v)
                        for k, v in t.items()} for t in trades[-20:]]
        yield emit("result", data={"stats": stats, "trades": last_trades})

    except Exception as e:
        yield emit("abort", msg=str(e))
