// The greeks of one open spread, read off the payoff grid the panel draws.
import { useCallback } from "react";
import { api, type Direction, type PayoffGrid } from "./api";
import { greeks, type Greeks } from "./greeks";
import { usePoll, type Poll } from "./usePoll";

export interface Spread {
  ticker: string;
  direction: Direction;
  shortStrike: number;
  longStrike: number;
  /** The credit the spread was sold for, or null while it has not filled. */
  credit: number | null;
  contracts: number;
  expiry: string;
}

/**
 * Delta and theta are first differences of the grid's own columns and rows, so one priced grid
 * answers both. Vega is a second difference and needs two more calls priced either side of the
 * vol, which is why it is not read here: only the payoff panel shows it.
 */
export async function spreadGreeks(s: Spread): Promise<Greeks> {
  const grid: PayoffGrid = await api.payoff({
    direction: s.direction,
    short_strike: s.shortStrike,
    long_strike: s.longStrike,
    credit: s.credit ?? 0,
    contracts: s.contracts,
    expiry: s.expiry,
    ticker: s.ticker,
  });
  return greeks(grid);
}

/**
 * The greeks of a spread, refreshed on `intervalMs`. A spread that has not filled has no credit to
 * price against, so its read never settles and the card shows a dash rather than a wrong number.
 */
export function useGreeks(s: Spread, intervalMs: number): Poll<Greeks> {
  const { ticker, direction, shortStrike, longStrike, credit, contracts, expiry } = s;
  const load = useCallback(
    () =>
      credit === null
        ? new Promise<Greeks>(() => {})
        : spreadGreeks({ ticker, direction, shortStrike, longStrike, credit, contracts, expiry }),
    [ticker, direction, shortStrike, longStrike, credit, contracts, expiry],
  );
  return usePoll(load, intervalMs);
}