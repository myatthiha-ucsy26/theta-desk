import { describe, expect, it } from "vitest";
import type { Spread } from "./api";
import { expiryPnl, payoffCurve, payoffLevels } from "./payoff";

const put: Spread = {
  side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388,
  roi_pct: 28.9, pop_pct: 68.2, breakeven: 468.88, short_delta: 0.28,
};

const call: Spread = {
  side: "call", short: 103, long: 108, width: 5, credit: 0.83, max_loss: 417,
  breakeven: 103.83,
};

describe("expiryPnl", () => {
  it("pays the credit in full once a put spread is clear of both strikes", () => {
    expect(expiryPnl(put, 480)).toBeCloseTo(112, 6);
  });

  it("loses exactly what the engine recorded as the max loss, once a put spread is under both strikes", () => {
    expect(expiryPnl(put, 450)).toBeCloseTo(-put.max_loss, 6);
  });

  it("slides between the two at a strike in between", () => {
    // At 468 the short put is $2 in the money and the long one is not yet.
    expect(expiryPnl(put, 468)).toBeCloseTo((1.12 - 2) * 100, 6);
  });

  it("reads the other way round for a call spread", () => {
    expect(expiryPnl(call, 95)).toBeCloseTo(83, 6);
    expect(expiryPnl(call, 120)).toBeCloseTo(-call.max_loss, 6);
    expect(expiryPnl(call, 105)).toBeCloseTo((0.83 - 2) * 100, 6);
  });

  it("breaks even at the price the engine recorded", () => {
    for (const s of [put, call]) {
      expect(expiryPnl(s, s.breakeven!)).toBeCloseTo(0, 6);
    }
  });

  it("never pays more than the credit or loses more than the width", () => {
    for (const s of [put, call]) {
      for (const spot of [10, 100, 300, 466, 469, 500, 900]) {
        const pnl = expiryPnl(s, spot);
        expect(pnl).toBeLessThanOrEqual(s.credit * 100 + 1e-6);
        // max_loss is already dollars per contract, so it is the bound directly.
        expect(pnl).toBeGreaterThanOrEqual(-s.max_loss - 1e-6);
      }
    }
  });

  it("hits its bounds exactly, so the worst case is the recorded max loss", () => {
    expect(Math.min(...payoffCurve(put, 60).map((p) => p.pnl))).toBeCloseTo(-put.max_loss, 6);
    expect(Math.max(...payoffCurve(put, 60).map((p) => p.pnl))).toBeCloseTo(put.credit * 100, 6);
  });
});

describe("payoffLevels", () => {
  it("spans past both strikes and the current spot", () => {
    const { lo, hi } = payoffLevels(put, 470);
    expect(lo).toBeLessThan(465);
    expect(hi).toBeGreaterThan(470);
  });

  it("keeps both strike plateaus in view when the spot is nowhere near them", () => {
    const { lo, hi } = payoffLevels(put, 300);
    expect(lo).toBeLessThanOrEqual(300);
    expect(hi).toBeGreaterThan(470);
  });

  it("takes the breakeven from the engine and falls back to the definition without one", () => {
    expect(payoffLevels(put).breakeven).toBe(468.88);
    expect(payoffLevels({ ...put, breakeven: undefined }).breakeven).toBeCloseTo(468.88, 6);
    expect(payoffLevels({ ...call, breakeven: undefined }).breakeven).toBeCloseTo(103.83, 6);
  });

  it("says which side of the breakeven a put spread pays on", () => {
    expect(payoffLevels(put).profitAbove).toBe(true);
    expect(payoffLevels(call).profitAbove).toBe(false);
  });

  it("reads the max loss off the spread, which is already dollars per contract", () => {
    expect(payoffLevels(put).maxLoss).toBe(put.max_loss);
    expect(payoffLevels(put).maxProfit).toBeCloseTo(112, 6);
  });
});

describe("payoffCurve", () => {
  it("runs left to right over the levels, one point per step", () => {
    const levels = payoffLevels(put, 470);
    const curve = payoffCurve(put, 12, levels.lo, levels.hi);
    expect(curve).toHaveLength(13);
    expect(curve[0].spot).toBeCloseTo(levels.lo, 6);
    expect(curve[12].spot).toBeCloseTo(levels.hi, 6);
    for (let i = 1; i < curve.length; i++) expect(curve[i].spot).toBeGreaterThan(curve[i - 1].spot);
  });

  it("is flat at both ends, so the plateaus are drawn flat", () => {
    const curve = payoffCurve(put, 60);
    const pnls = curve.map((p) => p.pnl);
    expect(pnls[0]).toBeCloseTo(pnls[1], 6);
    expect(pnls[58]).toBeCloseTo(pnls[59], 6);
  });
});