"""Backtest engine: Black-Scholes reconstruction of credit spreads over price history.

Reuses strategy (same signal logic as live) and pricing (BS). No historical option
chain needed: IV is estimated from realized vol (conservative). Hold-to-expiration,
cash-settle intrinsic, one open position per ticker at a time.

Run:  ./.venv/bin/python backtest.py --tickers SPY,QQQ,META,NVDA --years 2
"""
import argparse
import pandas as pd

from theta import strategy as cc
from theta.market.pricing import bs_price, bs_delta, estimate_iv, strike_for_delta
from theta.market import data as market_data
from theta import stats

DEFAULT_BASKET = ["SPY", "QQQ", "IWM", "META", "NVDA", "AMD",
                  "PLTR", "AAPL", "MSFT", "AMZN", "GOOGL", "TSLA"]


def strike_step(spot):
    return 5.0 if spot >= 200 else (2.5 if spot >= 50 else 1.0)


def rolling_rv(closes, window=20):
    """RV (factor 1.0) at each index using trailing `window` returns; None until enough."""
    out = [None] * len(closes)
    for i in range(len(closes)):
        if i >= window:
            out[i] = estimate_iv(closes[:i + 1], window=window, factor=1.0)
    return out


def iv_rank_at(rv_series, i, lookback=252):
    """Percentile rank of the current RV within its trailing window.

    RV stands in for IV here because no free historical option chain exists; the
    *statistic* matches market_data.iv_rank even though the input is a proxy.
    """
    cur = rv_series[i]
    if cur is None:
        return None
    hist = [v for v in rv_series[max(0, i - lookback):i + 1] if v is not None]
    return stats.percentile_rank(hist, cur, min_count=20)


def legs_for_side(spot, T, r, iv, side, step):
    ks, k = [], round(spot * 0.6 / step) * step
    hi = spot * 1.4
    while k <= hi:
        if k > 0 and ((side == "put" and k <= spot) or (side == "call" and k >= spot)):
            price = bs_price(spot, k, T, r, iv, side)
            if price > 0.01:
                ks.append({"strike": k, "delta": bs_delta(spot, k, T, r, iv, side), "price": price})
        k += step
    return ks


def run_backtest(ticker, df, modes, dte, target_delta=0.30, max_risk=500.0,
                 iv_factor=1.15, r=0.04, warmup=60, slippage=0.0):
    closes = df["close"].tolist()
    highs = df["high"].tolist()
    lows = df["low"].tolist()
    dates = df["date"].tolist()
    rv_series = rolling_rv(closes)
    trades = []
    open_until = None  # date index-blocking for one-position-at-a-time

    for t in range(warmup, len(closes) - 1):
        if open_until is not None and dates[t] <= open_until:
            continue
        c = closes[:t + 1]
        iv = estimate_iv(c, window=20, factor=iv_factor)
        rv = estimate_iv(c, window=20, factor=1.0)
        if iv <= 0:
            continue
        rank = iv_rank_at(rv_series, t)
        ind = cc.build_indicators(highs[:t + 1], lows[:t + 1], c,
                                  iv=iv, rv=rv, iv_rank=rank)
        dirs = [cc.verdict(m, ind)[0] for m in modes]
        direction = cc.combine(dirs) if len(dirs) > 1 else dirs[0]
        if direction == cc.NO_TRADE:
            continue

        spot = closes[t]
        T = dte / 365.0
        side = "put" if direction == cc.SELL_PUT else "call"
        step = strike_step(spot)
        legs = legs_for_side(spot, T, r, iv, side, step)
        sp = cc.build_spread(legs, direction, target_delta, max_risk)
        if not sp:
            continue

        # find expiration bar: first day >= entry + dte calendar days
        target_date = dates[t] + pd.Timedelta(days=dte)
        j = next((x for x in range(t + 1, len(dates)) if dates[x] >= target_date), None)
        if j is None:
            continue
        s_exp = closes[j]
        if side == "put":
            owed = max(sp["short_strike"] - s_exp, 0) - max(sp["long_strike"] - s_exp, 0)
        else:
            owed = max(s_exp - sp["short_strike"], 0) - max(s_exp - sp["long_strike"], 0)
        owed = min(max(owed, 0), sp["width"])
        pnl = (sp["credit"] - slippage - owed) * 100  # slippage = credit haircut $/share
        contracts = max(1, int(max_risk / sp["max_loss"]))
        pnl_total = round(pnl * contracts, 2)

        trades.append({
            "ticker": ticker, "entry": dates[t].date(), "expiry": dates[j].date(),
            "dte": dte, "mode": "+".join(modes), "direction": direction,
            "iv_rank": rank,
            "short": sp["short_strike"], "long": sp["long_strike"], "width": sp["width"],
            "credit": round(sp["credit"], 2), "max_loss": round(sp["max_loss"], 0),
            "contracts": contracts,
            "pnl": pnl_total, "win": pnl_total > 0,
        })
        open_until = dates[j]
    return trades


def aggregate(trades):
    n = len(trades)
    if n == 0:
        return {"n": 0}
    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    cum, peak, mdd = 0.0, 0.0, 0.0
    for p in pnls:
        cum += p
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    gross_win, gross_loss = sum(wins), abs(sum(losses))
    return {
        "n": n, "win_rate": len(wins) / n,
        "avg_win": (gross_win / len(wins)) if wins else 0.0,
        "avg_loss": (sum(losses) / len(losses)) if losses else 0.0,
        "expectancy": sum(pnls) / n,
        "total_pnl": sum(pnls),
        "profit_factor": (gross_win / gross_loss) if gross_loss else None,
        "max_drawdown": mdd,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(DEFAULT_BASKET))
    ap.add_argument("--years", type=int, default=2)
    ap.add_argument("--modes", default="meanrev,trend,ivrich",
                    help="comma list; each run independently for comparison")
    ap.add_argument("--dtes", default="7,14")
    ap.add_argument("--delta", type=float, default=0.30)
    ap.add_argument("--max-risk", type=float, default=500.0)
    ap.add_argument("--iv-factor", type=float, default=1.15)
    ap.add_argument("--r", type=float, default=0.04)
    ap.add_argument("--slippage", type=float, default=0.0,
                    help="credit haircut $/share per spread (commissions + fill slippage)")
    args = ap.parse_args()

    tickers = [x.strip().upper() for x in args.tickers.split(",") if x.strip()]
    modes_raw = [x.strip() for x in args.modes.split(",") if x.strip()]
    # support combined modes via "+" syntax: "ivrich+meanrev" → ["ivrich","meanrev"]
    modes = [x.split("+") for x in modes_raw]
    # flatten single-mode lists to strings for cleaner display
    modes = [m if len(m) > 1 else m[0] for m in modes]
    dtes = [int(x) for x in args.dtes.split(",") if x.strip()]
    end = pd.Timestamp.today().normalize()
    start = (end - pd.Timedelta(days=args.years * 365)).strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")

    # preload/cache klines
    data = {}
    for tk in tickers:
        try:
            data[tk] = market_data.fetch_klines(tk, start, end_s)
        except Exception as e:
            print(f"  skip {tk}: {e}")
    market_data.close_ctx()

    print(f"\nBacktest {start}..{end_s} | {len(data)} tickers | delta {args.delta} "
          f"| risk ${args.max_risk:.0f} | IV=RV*{args.iv_factor} | slippage ${args.slippage}/sh\n")
    header = f"{'mode':10}{'DTE':>4}{'trades':>8}{'win%':>7}{'avgWin':>9}{'avgLoss':>9}{'expect$':>9}{'PF':>6}{'total$':>9}{'maxDD$':>9}"
    print(header)
    print("-" * len(header))
    for mode_spec in modes:
        for dte in dtes:
            all_trades = []
            mode_list = mode_spec if isinstance(mode_spec, list) else [mode_spec]
            for tk, df in data.items():
                all_trades += run_backtest(tk, df, mode_list, dte,
                                           target_delta=args.delta, max_risk=args.max_risk,
                                           iv_factor=args.iv_factor, r=args.r,
                                           slippage=args.slippage)
            s = aggregate(all_trades)
            mode_label = "+".join(mode_list)
            if s["n"] == 0:
                print(f"{mode_label:10}{dte:>4}{0:>8}   (no trades)")
                continue
            pf = "inf" if s["profit_factor"] is None else f"{s['profit_factor']:.2f}"
            print(f"{mode_label:10}{dte:>4}{s['n']:>8}{s['win_rate']*100:>6.1f}%"
                  f"{s['avg_win']:>9.0f}{s['avg_loss']:>9.0f}{s['expectancy']:>9.1f}"
                  f"{pf:>6}{s['total_pnl']:>9.0f}{s['max_drawdown']:>9.0f}")
    print()


if __name__ == "__main__":
    main()
