// The expiry payoff of a credit spread: what the trade pays at each closing price. Pure.
// cs_payoff's surface row at d=0 is exact intrinsic, so this reproduces it without a round trip.
import type { Spread } from "./api";

/** P&L in dollars at expiry for one contract, at a closing price of `spot`. */
export function expiryPnl(s: Spread, spot: number): number {
  // Buying the spread back costs its intrinsic value, so it is the credit less that — floored at
  // zero and capped at the width, the same clamp cs_pricing.spread_value applies.
  const intrinsic =
    s.side === "put"
      ? Math.max(s.short - spot, 0) - Math.max(s.long - spot, 0)
      : Math.max(spot - s.short, 0) - Math.max(spot - s.long, 0);
  const cost = Math.min(Math.max(intrinsic, 0), s.width);
  return (s.credit - cost) * 100;
}

export interface PayoffLevels {
  /** The closing prices the chart covers, padded out past both strikes and the current spot. */
  lo: number;
  hi: number;
  /** Best and worst outcomes, in dollars per contract, both positive. */
  maxProfit: number;
  maxLoss: number;
  /** Where the curve crosses zero: the price the trade needs to beat. */
  breakeven: number;
  /** True when the trade is a loss below the breakeven and a profit above it. */
  profitAbove: boolean;
}

export function payoffLevels(s: Spread, spot?: number | null): PayoffLevels {
  const edge = [s.short, s.long, spot].filter((v): v is number => typeof v === "number" && v > 0);
  const low = Math.min(...edge);
  const high = Math.max(...edge);
  // The trade is at its best and worst at the strikes; pad so both plateaus are visible.
  const pad = (high - low) * 0.15 || high * 0.02 || 1;
  // A put spread pays when the price holds up; a call spread pays when it falls.
  const profitAbove = s.side === "put";
  // The engine records the breakeven when it prices the row; fall back to the definition.
  const fallback = profitAbove ? s.short - s.credit : s.short + s.credit;
  return {
    lo: low - pad,
    hi: high + pad,
    // The credit is per share, so it needs the multiplier; max_loss is already dollars per contract.
    maxProfit: s.credit * 100,
    maxLoss: s.max_loss,
    breakeven: s.breakeven ?? fallback,
    profitAbove,
  };
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

/** The payoff curve sampled left to right across `lo..hi`. Piecewise linear, so samples are exact. */
export function payoffCurve(s: Spread, steps = 60, lo?: number, hi?: number): PayoffPoint[] {
  const span = payoffLevels(s);
  const from = lo ?? span.lo;
  const to = hi ?? span.hi;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const spot = from + ((to - from) * i) / steps;
    return { spot, pnl: expiryPnl(s, spot) };
  });
}