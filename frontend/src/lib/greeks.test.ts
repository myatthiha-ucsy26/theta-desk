import { describe, expect, it } from "vitest";
import type { PayoffGrid } from "./api";
import { greeks, interpolateRow, nowPnl, stressRow } from "./greeks";

// A real grid from cs_payoff.payoff_grid("SELL_CALL", 103, 108, 0.83, 1, spot=104, days=10, σ=0.30),
// sampled down to seven neighbouring spot columns and the first three day-rows. Anchoring the test
// to the pricer's own output is the point of the module: these are differences of a real surface.
const SPOTS = [101.835, 102.487, 103.14, 103.793, 104.445, 105.097, 105.75];
const DAYS = [10, 9, 8];
const PNL = [
  [-39.91, -60.21, -81.84, -104.52, -127.95, -151.79, -175.69],
  [-34.64, -55.54, -77.96, -101.61, -126.12, -151.12, -176.22],
  [-28.65, -50.19, -73.49, -98.22, -123.99, -150.34, -176.83],
];

const grid: PayoffGrid = {
  spots: SPOTS,
  days: DAYS,
  pnl: PNL,
  breakeven: 103.83,
  max_profit: 83,
  max_loss: 417,
  spot: 103.7925,
  sigma: 0.3,
};

/** The grid with one column dropped, so the current spot falls on the outermost column. */
function edgeGrid(): PayoffGrid {
  return { ...grid, spot: 101.835 };
}

describe("nowPnl", () => {
  it("reads today's row at the spot the surface is centred on", () => {
    // The spot sits a hair under the 103.793 column, so this is that column's value, interpolated.
    expect(nowPnl(grid)).toBeCloseTo(-104.5026, 3);
  });

  it("agrees with the stress row's own zero shift, which reads the same instant", () => {
    expect(nowPnl(grid)).toBeCloseTo(stressRow(grid).find((p) => p.shiftPct === 0)!.pnl, 9);
  });
});

describe("interpolateRow", () => {
  const row = PNL[0];

  it("returns the listed value exactly at a listed spot", () => {
    expect(interpolateRow(SPOTS, row, 103.14)).toBeCloseTo(-81.84, 9);
    expect(interpolateRow(SPOTS, row, 104.445)).toBeCloseTo(-127.95, 9);
  });

  it("walks the segment linearly in between", () => {
    const mid = (103.14 + 103.793) / 2;
    expect(interpolateRow(SPOTS, row, mid)).toBeCloseTo((-81.84 + -104.52) / 2, 6);
  });

  it("holds flat past either end, where the row is genuinely flat", () => {
    expect(interpolateRow(SPOTS, row, 50)).toBeCloseTo(-39.91, 9);
    expect(interpolateRow(SPOTS, row, 500)).toBeCloseTo(-175.69, 9);
  });

  it("survives a one-column row rather than dividing by zero", () => {
    expect(interpolateRow([100], [-5], 100)).toBe(-5);
  });
});

describe("greeks", () => {
  it("reads a short-delta spread as a negative share count", () => {
    // Between the strikes the position is short stock, so it loses about $35 per $1 of spot.
    expect(greeks(grid).delta).toBeCloseTo(-46.11 / 1.305, 6);
    expect(greeks(grid).delta).toBeLessThan(0);
    expect(greeks(grid).delta).toBeGreaterThan(-100);
  });

  it("takes theta as the P&L gained by one day passing", () => {
    // Row 9 is one day nearer expiry and $2.91 better off, so decay is in the seller's favour.
    expect(greeks(grid).theta).toBeCloseTo(-101.61 - -104.52, 9);
    expect(greeks(grid).theta).toBeGreaterThan(0);
  });

  it("divides theta by the gap a long-dated grid actually took", () => {
    const sparse: PayoffGrid = { ...grid, days: [60, 58, 0] };
    expect(greeks(sparse).theta).toBeCloseTo((-101.61 - -104.52) / 2, 9);
  });

  it("takes a second difference for gamma, in the same share units", () => {
    expect(greeks(grid).gamma).toBeCloseTo((-127.95 - 2 * -104.52 + -81.84) / (0.652 * 0.652), 6);
  });

  it("reports no theta when the grid has only the expiry row left", () => {
    expect(greeks({ ...grid, days: [0], pnl: [PNL[0]] }).theta).toBe(0);
  });

  it("falls back to a one-sided slope on the outermost column", () => {
    // A slope is still a slope at the edge; only the second difference would be noise.
    const g = greeks(edgeGrid());
    expect(g.delta).toBeCloseTo((-60.21 - -39.91) / 0.652, 6);
    expect(g.gamma).toBe(0);
  });

  it("reports no vega unless it is given a bump to difference", () => {
    expect(greeks(grid).vega).toBeNull();
  });

  it("reads vega off two bumped grids, in dollars per vol point", () => {
    const g = greeks(grid, { up: -101.52, down: -107.52, step: 0.01 });
    // A $6 swing across two 0.01 vol steps, scaled to one percentage point of IV.
    expect(g.vega).toBeCloseTo((( -101.52 - -107.52) / 0.02) * 0.01, 9);
  });
});

describe("stressRow", () => {
  // A wide, deliberately linear row so all five shifts land inside it and the expected values are
  // exact. The real grid spans only seven columns here, which few of the shifts would reach.
  const wide: PayoffGrid = {
    ...grid,
    spots: Array.from({ length: 21 }, (_, i) => 80 + i * 2.5),
    pnl: [Array.from({ length: 21 }, (_, i) => -10 * (80 + i * 2.5 - 104))],
    spot: 104,
  };
  const at = (spot: number) => -10 * (spot - 104);

  it("reads the five shifts in the order they are drawn", () => {
    expect(stressRow(wide).map((p) => p.shiftPct)).toEqual([-5, -2, 0, 2, 5]);
  });

  it("is flat zero at the current spot when the book is at breakeven", () => {
    expect(stressRow(wide).find((p) => p.shiftPct === 0)?.pnl).toBeCloseTo(0, 9);
  });

  it("loses ground as the spot rises, shift by shift", () => {
    const row = stressRow(wide);
    for (let i = 1; i < row.length; i++) expect(row[i].pnl).toBeLessThan(row[i - 1].pnl);
  });

  it("values each shift off the spot, not off the last shift", () => {
    expect(stressRow(wide)[4].pnl).toBeCloseTo(at(104 * 1.05), 9);
    expect(stressRow(wide)[0].pnl).toBeCloseTo(at(104 * 0.95), 9);
  });

  it("clamps a shift that lands past the end of the grid", () => {
    expect(stressRow(wide, [-50])[0].pnl).toBeCloseTo(at(80), 9);
    expect(stressRow(wide, [50])[0].pnl).toBeCloseTo(at(130), 9);
  });
});