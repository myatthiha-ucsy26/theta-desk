# Credit Spread Signal + Backtest — Design Spec

Date: 2026-09-13

> The strategy below is what the desk implements today: the gates, the
> thresholds and the strike rules are current. The file layout and the phasing
> are kept as written, as a record of how it was planned — both phases are long
> since done, and the code has moved. `docs/architecture.md` describes where it
> actually lives now.

## Goal

An objective, repeatable credit-spread **entry + strike-selection** tool that removes
the discretionary "skill barrier" (feeling entries are luck). Direction and strikes are
decided by explicit rules, not gut feel. **Validated by backtest before any live use.**

## Decision gate (non-negotiable)

Phase 1 (live dashboard) is built **only if** Phase 0 backtest shows **positive
expectancy** — overall and/or per-mode — across a multi-ticker, multi-year sample.
If expectancy is negative, we revise the rules, not ship them.

## Scope

- Underlyings: liquid optionable US stocks/ETFs (basket configurable).
- Spreads: bull put (SELL PUT) + bear call (SELL CALL), defined risk only.
- DTE: `1w` (~7) or `2w` (~14). **Max 2 weeks.** Default: 7 only,
  bull puts only (see [Measured under the bot's exits](#measured-under-the-bots-exits)).
- Short leg: target **delta 0.30** (POP ~70%). Long leg: chosen within **max-risk $500**.
- Signal modes: **mean-reversion (default)**, **trend**, **iv-rich**. Combinable (AND).

## Data sources (feasibility-confirmed)

- **moomoo OpenD** (`futu`): spot, daily klines, current option chain w/ IV + greeks.
  - 1-year daily kline pull is fast (~0.1s). Multi-year can hit Futu's history quota →
    **cache klines to CSV** (`klines_cache/<T>.csv`), fetch once, reuse.
  - Option-chain snapshot bug (missing `strike_price` in snapshot) **fixed** in `server.py`.
- **No free historical option chains.** → Phase 0 uses **Black-Scholes reconstruction**.
- Alpha Vantage `HISTORICAL_OPTIONS` = **premium-blocked** → deferred to v2 (exact backtest).

## Signal logic — `cs_core.py` (shared by backtest AND live)

Indicators from daily klines: RSI(14), Bollinger %B(20,2), EMA20, EMA50, ADX(14),
ATR(14), realized vol(20d), Expected Move = `spot · IV · sqrt(DTE/365)`.

| Mode | SELL PUT (bull put) | SELL CALL (bear call) | NO TRADE |
|---|---|---|---|
| **mean-rev** (default) | oversold (RSI<35 or %B<0.1) AND stabilizing (close>prev, not fresh lower-low) | overbought (RSI>65 or %B>0.9) AND rejection | neutral; **falling-knife guard**: fresh lower-low + strong down ADX → skip |
| **trend** | EMA20>EMA50 & close>EMA20 & ADX>20 | EMA20<EMA50 & close<EMA20 & ADX>20 | chop (ADX<20) |
| **iv-rich** | vol rank ≥ 2/3, then mean-rev on top (IV/RV>1.2 when too little history to rank) | same | not rich → block |

"Vol rank" is the percentile of the 20-day realised vol within its trailing year
(`backtest.iv_rank_at`). Live and backtest rank the same input. An earlier version
ranked logged ATM IV live, while the edge table was bucketed on realised vol, so
a signal could be judged against a cell it never belonged to.

- Always compute all three; report each verdict + a consensus line.
- `--mode` picks the **binding** decision (default mean-rev). Multiple modes ⇒ any one firing is enough; modes firing on opposite sides cancel to no trade.

## Strike selection — `cs_core.py`

- Short strike = **target delta 0.30** (BS delta in backtest; live = snapshot delta).
- Long strike = maximizes credit within **max-loss ≤ $500**; OI floor (live only).
- Outputs: credit, width, max loss, ROI, POP = 1−|Δ_short|, breakeven, Expected-Move compare.
- The auto bot trades a fixed **5-wide** spread at the same short strike
  (`autotrade.five_wide`), and the edge table is measured on that shape.
- Live legs are priced at the mid of a two-sided quote. A leg with no ask, or no
  delta, is dropped rather than priced off its last trade.

## Black-Scholes reconstruction — `cs_pricing.py` (Phase 0 backtest)

- IV estimate per entry day = **trailing 20d realized vol × F** (default F=1.15, configurable).
  Rationale: real IV usually exceeds RV; this keeps collected credit **conservative** (pessimistic bias = safe).
- Price short + long legs via BS at entry → collect mid credit.
- Settle at expiration from the underlying close on/near the expiry date:
  `spread_pnl = credit − (short_intrinsic − long_intrinsic)`, floored at `−(width − credit)`.
- Risk-free rate r = 0.04 default; dividends ignored (short DTE).
- Assumptions (v1): hold to expiration; cash-settle intrinsic; **one open position per ticker
  at a time**; no commissions/slippage (optional slippage haircut param).
- `run_backtest` also takes `tp_pct`, `sl_multiple` and `width`. With
  them, each open spread is marked at every daily close (Black-Scholes at the entry IV)
  and closed at the take profit or the stop, using the same thresholds as
  `autotrade.tp_price` and `autotrade.sl_breached`. Slippage is charged on the credit
  and again on any early buy-back. The edge table is always built this way.

### Measured under the bot's exits

27 tickers, 2021-09..2026-09, `ivrich`, 5-wide, $0.10/share slippage, stop at 3× credit:

| Exit rule | 7d $/trade | 14d $/trade |
|---|---|---|
| Hold to expiry | +42 | +41 |
| Take profit 50% | +24 | +15 |
| Take profit 80% | +38 | +30 |
| Take profit 50%, IV priced at RV × 1.0 | +13 | +3 |

A 50% take profit cuts every winner short while the losers still run to the stop.
Bull puts at 7d with an 80% take profit made +$53.5 over 346 trades; bear calls about
half that. 14d is the fragile choice: most of its edge rests on the IV = RV × 1.15
assumption. Hence the defaults: `tp_pct` 80, `dtes` [7], `directions` [SELL_PUT].

Limits of this model: daily closes only, so intraday touches of the take profit or
the stop are missed; no gaps inside a bar, no early assignment, no bid/ask on the
legs; IV held at its entry value while the spread is open.

## Backtest harness — `cs_backtest.py`

- Loop each ticker's cached klines (default 2y where available, else 1y).
- Each eligible day: indicators → verdict(mode) → if trade, build + price spread, settle at expiry.
- Aggregate: n trades, win%, avg win, avg loss, **expectancy/trade**, total P&L, max drawdown,
  profit factor; breakdown by mode, by DTE, by ticker.
- Output: printed report + JSON. (Equity curve = later.)

## File layout

As planned (see the note at the top; today's names are in brackets):

```
  cs_core.py            # indicators · 3 filters · iv_rank · strike builder (PURE)
                        #   [theta/strategy.py, with iv_rank in theta/stats.py]
  cs_pricing.py         # Black-Scholes + IV estimate (PURE)
                        #   [theta/market/pricing.py]
  cs_backtest.py        # harness → stats
                        #   [theta/research/backtest.py]
  klines_cache/<T>.csv  # cached daily klines (quota-safe)      [unchanged]
  iv_history/<T>.csv    # logged ATM IV → true IV rank over time [unchanged]
  test_cs_core.py       # unit tests (no OpenD)
  test_cs_pricing.py    # BS reference + parity tests
                        #   [backend/tests/, mirroring the package]
  # Phase 1 (only if gate passes):
  app.py                # Flask: /api/signal → JSON; serves index.html
                        #   [theta/api/, seven blueprints; the UI is frontend/]
  static/index.html     # dashboard UI
                        #   [replaced by the React desk in frontend/]
```

## Testing (TDD)

- Indicators: known-series unit tests (RSI/ADX/%B/EMA vs hand-computed).
- Verdicts: table-driven (oversold+stabilize → SELL PUT; knife → NO TRADE; chop → NO TRADE; …).
- Pricing: BS vs known reference values; put-call parity; delta monotonicity.
- Backtest: synthetic price series with known outcome → expected P&L sign.

## Phasing

- **Phase 0:** `cs_core` + `cs_pricing` + `cs_backtest` (+ tests) → run basket → **DECISION GATE**.
- **Phase 1 (if gate passes):** `app.py` + `index.html` live dashboard reusing the validated `cs_core`.

## Deferred (v2)

True IV rank via premium data; exact backtest with real historical option chains
(both would retire the IV = RV × F assumption the edge rests on). Trade management
and a slippage haircut are no longer deferred: see above.
