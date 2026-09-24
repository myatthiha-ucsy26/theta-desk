// Black-Scholes, ported from theta/market/pricing.py and payoff.py, so the demo's payoff surface is
// priced the same way the real desk prices one. Pure.
import type { Direction, PayoffGrid } from "../api";

const R = 0.04;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf; well inside a cent at these sizes). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

export function bsPrice(S: number, K: number, T: number, sigma: number, opt: "call" | "put"): number {
  if (T <= 0 || sigma <= 0) return opt === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R + 0.5 * sigma * sigma) * T) / v;
  const d2 = d1 - v;
  const disc = Math.exp(-R * T);
  return opt === "call" ? S * normCdf(d1) - K * disc * normCdf(d2) : K * disc * normCdf(-d2) - S * normCdf(-d1);
}

export function bsDelta(S: number, K: number, T: number, sigma: number, opt: "call" | "put"): number {
  if (T <= 0 || sigma <= 0) return opt === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (R + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return opt === "call" ? normCdf(d1) : normCdf(d1) - 1;
}

/** Cost per share to close a credit spread now. Always in [0, width]. */
export function spreadValue(spot: number, short: number, long: number, T: number, sigma: number, direction: Direction): number {
  const opt = direction === "SELL_PUT" ? "put" : "call";
  const v = bsPrice(spot, short, T, sigma, opt) - bsPrice(spot, long, T, sigma, opt);
  return Math.min(Math.max(v, 0), Math.abs(short - long));
}

const MAX_DAY_ROWS = 31;

function dayAxis(daysLeft: number): number[] {
  const d = Math.max(Math.trunc(daysLeft), 0);
  if (d < MAX_DAY_ROWS) return Array.from({ length: d + 1 }, (_, i) => d - i);
  const n = MAX_DAY_ROWS - 1;
  return [...new Set(Array.from({ length: n + 1 }, (_, i) => Math.round((d * i) / n)))].sort((a, b) => b - a);
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function payoffGrid(direction: Direction, short: number, long: number, credit: number, contracts: number,
  spot: number, daysLeft: number, sigma: number, nSpots = 41): PayoffGrid {
  const width = Math.abs(short - long);
  const lo = Math.min(spot, short, long) * 0.9;
  const hi = Math.max(spot, short, long) * 1.1;
  const step = (hi - lo) / (nSpots - 1);
  const spots = Array.from({ length: nSpots }, (_, i) => Math.round((lo + i * step) * 1e4) / 1e4);
  const days = dayAxis(daysLeft);
  const pnl = days.map((d) => spots.map((s) => r2((credit - spreadValue(s, short, long, d / 365, sigma, direction)) * 100 * contracts)));
  const breakeven = direction === "SELL_PUT" ? short - credit : short + credit;
  return {
    spots, days, pnl, breakeven: Math.round(breakeven * 1e4) / 1e4,
    max_profit: r2(credit * 100 * contracts), max_loss: r2(-(width - credit) * 100 * contracts), spot, sigma,
  };
}
