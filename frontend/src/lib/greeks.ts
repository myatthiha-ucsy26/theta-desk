// The greeks of a spread, read off the payoff surface the app already computes.
//
// Nothing here models a sensitivity on its own: every figure is a finite difference of the same
// pricer that marks the position (cs_pricing.spread_value, through /api/payoff). A greek therefore
// cannot disagree with the P&L it belongs to -- the two are one curve, sampled twice. The bump
// widths are the grid's own spacing, so each difference is as fine as the surface already drawn.
import type { PayoffGrid } from "./api";

export interface Greeks {
  /**
   * Share equivalents, which is what a dollar P&L differentiated by a dollar of spot already is:
   * a position short 100 shares moves -$100 per $1, and reads -100. No multiplier needed.
   */
  delta: number;
  /** How far delta itself moves per $1 of spot, in the same share units. */
  gamma: number;
  /** Dollars earned per calendar day of decay, at the current spot. */
  theta: number;
  /** Dollars per vol point (one percentage point of IV), or null without a bump to difference. */
  vega: number | null;
}

/** Index of the listed value nearest `value`. */
function nearest(xs: number[], value: number): number {
  return xs.reduce((best, x, i) => (Math.abs(x - value) < Math.abs(xs[best] - value) ? i : best), 0);
}

/**
 * P&L at the current spot, on today's row: the value the whole surface is centred on.
 * Interpolated, like the stress row's own zero shift, so the same instant cannot read two ways.
 */
export function nowPnl(grid: PayoffGrid): number {
  return interpolateRow(grid.spots, grid.pnl[0], grid.spot);
}

/**
 * P&L at `x`, linearly interpolated along one row of the grid. Flat past either end: the row
 * really is flat out there, because both strikes sit well inside the grid's own span.
 */
export function interpolateRow(xs: number[], row: number[], x: number): number {
  const last = xs.length - 1;
  if (last < 1) return row[0] ?? 0;
  if (x <= xs[0]) return row[0];
  if (x >= xs[last]) return row[last];
  let hi = 1;
  while (hi < last && xs[hi] < x) hi++;
  const lo = hi - 1;
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return row[lo] + (row[hi] - row[lo]) * t;
}

/**
 * The four sensitivities at the current spot. Differences are central where the spot has a
 * neighbour on each side, which is everywhere but the grid's outermost columns; at an edge a
 * one-sided slope is still a slope, but a second difference there is noise, so gamma reads 0.
 */
export function greeks(grid: PayoffGrid, vegaBump?: { up: number; down: number; step: number }): Greeks {
  const { spots, pnl } = grid;
  const i = nearest(spots, grid.spot);
  const row = pnl[0];
  const last = spots.length - 1;

  const step = spots.length > 1 ? spots[1] - spots[0] : 0;
  let slope = 0;
  let curvature = 0;
  if (step > 0) {
    if (i > 0 && i < last) {
      slope = (row[i + 1] - row[i - 1]) / (spots[i + 1] - spots[i - 1]);
      curvature = (row[i + 1] - 2 * row[i] + row[i - 1]) / (step * step);
    } else if (i === 0) {
      slope = (row[1] - row[0]) / step;
    } else {
      slope = (row[last] - row[last - 1]) / step;
    }
  }

  // The row below today is one day nearer expiry. On a long-dated grid the axis is sparse, so
  // divide by the gap the axis actually took rather than assuming a single day.
  const gap = pnl.length > 1 ? grid.days[0] - grid.days[1] : 0;
  const theta = gap > 0 ? (pnl[1][i] - row[i]) / gap : 0;

  const vega = vegaBump && vegaBump.step > 0
    ? ((vegaBump.up - vegaBump.down) / (2 * vegaBump.step)) * 0.01
    : null;

  return { delta: slope, gamma: curvature, theta, vega };
}

export interface StressPoint {
  /** The spot shift as a percentage, e.g. 5 for +5%. */
  shiftPct: number;
  pnl: number;
}

/** P&L at each spot shift, read off today's row. */
export function stressRow(grid: PayoffGrid, shifts: number[] = [-5, -2, 0, 2, 5]): StressPoint[] {
  return shifts.map((shiftPct) => ({
    shiftPct,
    pnl: interpolateRow(grid.spots, grid.pnl[0], grid.spot * (1 + shiftPct / 100)),
  }));
}