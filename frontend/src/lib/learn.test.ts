import { describe, expect, it } from "vitest";
import type { EdgeCell } from "./api";
import { edgeSummary, pairedSpan } from "./learn";

const cell = (over: Partial<EdgeCell> = {}): EdgeCell => ({
  mode: "ivrich",
  dte: 7,
  bucket: "mid",
  n: 100,
  expectancy: 12,
  win_rate: 0.8,
  validated: true,
  passes: true,
  ...over,
});

describe("edgeSummary", () => {
  it("counts the setups that pass against the ones that could be judged", () => {
    const s = edgeSummary([
      cell({ n: 120, expectancy: 30, passes: true }),
      cell({ n: 80, expectancy: -14, passes: false }),
      // Too few trades to be judged, so it counts towards neither side of the ratio.
      cell({ n: 9, expectancy: 90, validated: false, passes: false }),
    ]);

    expect(s.setups).toBe(3);
    expect(s.samples).toBe(209);
    expect(s.validated).toBe(2);
    expect(s.passing).toBe(1);
  });

  it("weights the win rate by trades rather than averaging the rates", () => {
    // 80% over 300 and 50% over 100 is 72.5%, not the 65% an unweighted mean would give.
    const s = edgeSummary([cell({ n: 300, win_rate: 0.8 }), cell({ n: 100, win_rate: 0.5 })]);

    expect(s.rated).toBe(400);
    expect(s.winRate).toBeCloseTo(0.725, 6);
  });

  it("leaves the win rate unmeasured when no setup carries one", () => {
    const s = edgeSummary([cell({ win_rate: null }), cell({ win_rate: null })]);

    expect(s.winRate).toBeNull();
    expect(s.rated).toBe(0);
  });

  it("picks the best setup from the measured ones only", () => {
    const high = cell({ mode: "trend", dte: 14, expectancy: 41 });
    const s = edgeSummary([cell({ expectancy: 8 }), high, cell({ expectancy: 99, validated: false })]);

    // The 99 belongs to a setup with too few trades, so it is not the desk's best measured one.
    expect(s.best).toBe(high);
  });

  it("reports nothing to be best at when no setup is measured", () => {
    const s = edgeSummary([cell({ validated: false })]);

    expect(s.best).toBeNull();
  });

  it("adds up to zero on an empty table", () => {
    const s = edgeSummary([]);

    expect(s).toEqual({ setups: 0, samples: 0, validated: 0, passing: 0, rated: 0, winRate: null, best: null });
  });
});

describe("pairedSpan", () => {
  it("takes the widest magnitude on either side, so both series share a scale", () => {
    expect(pairedSpan([{ paper_expectancy: 10, backtest_expectancy: -40 }])).toBe(40);
  });

  it("ignores a backtest with no figure rather than reading it as a zero", () => {
    expect(pairedSpan([{ paper_expectancy: 12, backtest_expectancy: null }])).toBe(12);
  });

  it("has no span when nothing is measured", () => {
    expect(pairedSpan([{ paper_expectancy: 0, backtest_expectancy: null }])).toBeNull();
    expect(pairedSpan([])).toBeNull();
  });
});