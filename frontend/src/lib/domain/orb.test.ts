import { describe, expect, it } from "vitest";
import { IDLE_SPIN, MAX_RINGS, orbParams } from "./orb";

const stats = (over: Partial<Parameters<typeof orbParams>[0] & object> = {}) => ({
  total_pnl: 0, wins: 0, losses: 0, win_rate: 0, open_count: 0, deployed_risk: 0, risk_cap: 1000, ...over,
});

describe("orbParams", () => {
  it("turns fast enough at idle to be seen turning: under 20 seconds a revolution", () => {
    expect((2 * Math.PI) / IDLE_SPIN).toBeLessThan(20);
  });

  it("is an idle, neutral orb before the book has loaded", () => {
    expect(orbParams(null)).toEqual({ rings: 0, tone: "flat", spin: IDLE_SPIN });
  });

  it("draws one ring per open position, capped", () => {
    expect(orbParams(stats({ open_count: 3 })).rings).toBe(3);
    expect(orbParams(stats({ open_count: 40 })).rings).toBe(MAX_RINGS);
  });

  it("takes its tone from the sign of realised P&L", () => {
    expect(orbParams(stats({ total_pnl: 182 })).tone).toBe("profit");
    expect(orbParams(stats({ total_pnl: -5 })).tone).toBe("loss");
    expect(orbParams(stats({ total_pnl: 0 })).tone).toBe("flat");
  });

  it("spins faster the more of the risk cap is deployed, clamped at the cap", () => {
    const idle = orbParams(stats({ deployed_risk: 0 })).spin;
    const half = orbParams(stats({ deployed_risk: 500 })).spin;
    const full = orbParams(stats({ deployed_risk: 1000 })).spin;
    expect(idle).toBeLessThan(half);
    expect(half).toBeLessThan(full);
    expect(orbParams(stats({ deployed_risk: 5000 })).spin).toBe(full);
  });

  it("does not divide by a zero cap", () => {
    expect(orbParams(stats({ risk_cap: 0, deployed_risk: 100 })).spin).toBe(IDLE_SPIN);
  });
});

describe("orbParams on the live account", () => {
  const live = { account: "live" as const, cash: 0, currency: "USD", net_value: 1187, unrealized_pl: -240, open_count: 4 };

  it("reads the real account, not the paper book", () => {
    expect(orbParams(stats({ open_count: 0, total_pnl: 0 }), live, 5)).toMatchObject({ rings: 4, tone: "loss" });
    expect(orbParams(null, { ...live, unrealized_pl: 90 }, 5).tone).toBe("profit");
  });

  it("spins with the share of the position cap in use", () => {
    const two = orbParams(null, { ...live, open_count: 2 }, 5).spin;
    const four = orbParams(null, live, 5).spin;
    expect(two).toBeGreaterThan(IDLE_SPIN);
    expect(four).toBeGreaterThan(two);
    expect(orbParams(null, live, null).spin).toBe(IDLE_SPIN);
  });

  it("stays on the paper book while the desk trades on paper", () => {
    const paperAccount = { account: "paper" as const, cash: 10000, currency: "USD", power: 10000 };
    expect(orbParams(stats({ open_count: 3, total_pnl: 50 }), paperAccount, 5)).toMatchObject({ rings: 3, tone: "profit" });
  });
});
