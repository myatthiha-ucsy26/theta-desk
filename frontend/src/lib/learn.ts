import type { EdgeCell } from "./api";

/**
 * What the edge table adds up to, as one reading of it.
 *
 * Every figure here is summed off the cells the engine built; nothing is modelled on top. The
 * weighted win rate is weighted by trades, because a setup measured over 500 trades says more about
 * the desk than one measured over 20, and averaging the rates would give them the same say.
 */
export interface EdgeSummary {
  /** Setups the table holds, measured or not. */
  setups: number;
  /** Trades across every setup in it. */
  samples: number;
  /** Setups with enough trades behind them to be judged at all. */
  validated: number;
  /** Of those, the ones whose expectancy came out positive — what the gate is for. */
  passing: number;
  /** Trade-weighted win rate over the setups that carry one. Null when none does. */
  winRate: number | null;
  /** Trades behind the setups that carry a win rate. */
  rated: number;
  /** The measured setup with the highest expectancy. Null when none is measured. */
  best: EdgeCell | null;
}

export function edgeSummary(cells: EdgeCell[]): EdgeSummary {
  let samples = 0;
  let validated = 0;
  let passing = 0;
  let rated = 0;
  let wins = 0;
  let best: EdgeCell | null = null;

  for (const c of cells) {
    samples += c.n;
    if (c.validated) validated += 1;
    if (c.passes) passing += 1;
    if (c.win_rate !== null && c.n > 0) {
      rated += c.n;
      wins += c.win_rate * c.n;
    }
    if (c.validated && (best === null || c.expectancy > best.expectancy)) best = c;
  }

  return {
    setups: cells.length,
    samples,
    validated,
    passing,
    rated,
    winRate: rated > 0 ? wins / rated : null,
    best,
  };
}

/**
 * The stretch of expectancy the paired bars are drawn across: the largest magnitude on either side,
 * so the two series share one scale and a bar's length means the same thing on both.
 *
 * Returns null when nothing is measured, which is the caller's cue to draw no bars rather than
 * zero-width ones that would read as a measured nil.
 */
export function pairedSpan(
  rows: { paper_expectancy: number; backtest_expectancy: number | null }[],
): number | null {
  let widest = 0;
  for (const r of rows) {
    widest = Math.max(widest, Math.abs(r.paper_expectancy));
    if (r.backtest_expectancy !== null) widest = Math.max(widest, Math.abs(r.backtest_expectancy));
  }
  return widest > 0 ? widest : null;
}