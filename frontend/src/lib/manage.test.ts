import { describe, expect, it } from "vitest";
import type { Account, BotStatus, LiveTrade } from "./api";
import { countdown, exposure, settlement } from "./manage";

/**
 * The bot's real META put spread as it stands: sold at $1.30, $1.57 to buy back, 5 wide.
 * Anchoring the fixtures to it keeps the arithmetic tied to a position that actually exists.
 */
function trade(over: Partial<LiveTrade> = {}): LiveTrade {
  return {
    id: "t1", ticker: "META", direction: "SELL_PUT", expiry: "2026-09-23",
    short_strike: 657.5, long_strike: 652.5, width: 5, contracts: 1,
    planned_credit: 1.3, state: "open", credit: 1.3, tp_order_id: "TP1", tp_tif: "GTC",
    sl_hits: 0, close_price: null, exit_reason: null, close_debit: null, fees: 2.84,
    pnl: null, ai_reason: null, last_ai_check: null,
    opened_at: "2026-09-17T15:23:38+00:00", filled_at: "2026-09-17T15:24:10+00:00", closed_at: null,
    ...over,
  };
}

const bot: BotStatus = {
  mode: "manual", account_mode: "paper", paused: true, pause_reason: "stopped by you",
  monitor: { state: "ok", last_ok: null, last_error: null },
  net_pnl: 0, slots: 4, next_slot_at: 2000,
  active: [trade()],
  closed: [
    trade({ id: "c1", state: "closed", pnl: 61.16, exit_reason: "tp", closed_at: "2026-09-15T18:00:00+00:00" }),
    trade({ id: "c2", state: "closed", pnl: -88.4, exit_reason: "sl", closed_at: "2026-09-16T18:00:00+00:00" }),
    // An entry that never filled: neither a win nor a loss.
    trade({ id: "c3", state: "entry_cancelled", credit: null, pnl: null, exit_reason: null }),
  ],
  // Cost to buy the open spread back, which is what the monitor compares against TP and SL.
  marks: { t1: 1.57 },
  events: [],
};

const account: Account = { account: "live", net_value: 1564, cash: 900, buying_power: 4000,
  unrealized_pl: 48, open_count: 4, currency: "USD",
};

describe("exposure", () => {
  it("has nothing to say until the bot status loads", () => {
    expect(exposure(null, account)).toBeNull();
  });

  it("sums the credit sold and the margin the broker holds against it", () => {
    const e = exposure(bot, account)!;
    // $1.30 a share over 100 shares, against a 5-wide spread the broker holds in full.
    expect(e.credit).toBeCloseTo(130, 9);
    expect(e.margin).toBeCloseTo(500, 9);
    expect(e.count).toBe(1);
  });

  it("reads the open spread's P&L off its mark", () => {
    // Sold at 1.30, 1.57 to close: 27 cents a share against the position.
    expect(exposure(bot, account)!.unrealized).toBeCloseTo(-27, 9);
    expect(exposure(bot, account)!.unmarked).toBe(0);
  });

  it("counts an unpriced spread as zero rather than dropping it", () => {
    const blind: BotStatus = { ...bot, marks: {} };
    const e = exposure(blind, account)!;
    expect(e.unmarked).toBe(1);
    expect(e.unrealized).toBe(0);
    // The credit and the margin are read off the fill, not the mark, so they survive.
    expect(e.credit).toBeCloseTo(130, 9);
    expect(e.margin).toBeCloseTo(500, 9);
  });

  it("holds nothing against an entry that has not filled", () => {
    const entering: BotStatus = {
      ...bot,
      active: [trade({ state: "entering", credit: null })],
      marks: {},
    };
    const e = exposure(entering, account)!;
    expect(e.credit).toBe(0);
    expect(e.margin).toBe(0);
    expect(e.unmarked).toBe(1);
  });

  it("reads margin against the real account's net value", () => {
    expect(exposure(bot, account)!.navPct).toBeCloseTo((500 / 1564) * 100, 9);
  });

  it("reports no NAV share without an account to divide by", () => {
    expect(exposure(bot, null)!.navPct).toBeNull();
    expect(exposure(bot, { ...account, net_value: 0 })!.navPct).toBeNull();
  });

  it("reads the captured share of credit, the quantity the 50% take-profit measures", () => {
    expect(exposure(bot, account)!.capturedPct).toBeCloseTo((-27 / 130) * 100, 9);
  });

  it("scores the closed book, skipping the entries that never filled", () => {
    const e = exposure(bot, account)!;
    expect(e.realized).toBeCloseTo(61.16 - 88.4, 9);
    expect(e.wins).toBe(1);
    expect(e.losses).toBe(1);
    expect(e.winRate).toBe(0.5);
  });

  it("reports no win rate before anything has closed", () => {
    const fresh: BotStatus = { ...bot, closed: [] };
    const e = exposure(fresh, account)!;
    expect(e.winRate).toBe(0);
    expect(e.realized).toBe(0);
    expect(e.wins).toBe(0);
  });
});

describe("settlement", () => {
  const now = new Date("2026-09-19T14:00:00Z");

  it("has no close to count down to with nothing open", () => {
    expect(settlement([], now)).toEqual({ expiry: null, count: 0, at: null, msLeft: null });
  });

  it("takes the nearest expiry, not the first one listed", () => {
    const late = trade({ id: "b", expiry: "2026-10-16" });
    expect(settlement([late, trade()], now).expiry).toBe("2026-09-23");
  });

  it("counts only the spreads sharing that expiry", () => {
    const s = settlement([trade(), trade({ id: "b" }), trade({ id: "c", expiry: "2026-10-16" })], now);
    expect(s.count).toBe(2);
  });

  it("closes at 3 PM New York on the expiry day", () => {
    // Sep 23 is inside US daylight time, so 15:00 EDT is 19:00 UTC.
    expect(settlement([trade()], now).at!.toISOString()).toBe("2026-09-23T19:00:00.000Z");
  });

  it("follows New York across the daylight-saving change", () => {
    // Jan 15 is standard time, so 15:00 EST is 20:00 UTC.
    expect(settlement([trade({ expiry: "2027-01-15" })], now).at!.toISOString())
      .toBe("2027-01-15T20:00:00.000Z");
  });

  it("measures the wait from now, and goes negative once it has passed", () => {
    expect(settlement([trade()], now).msLeft).toBe(
      new Date("2026-09-23T19:00:00Z").getTime() - now.getTime(),
    );
    expect(settlement([trade()], new Date("2026-09-24T00:00:00Z")).msLeft).toBeLessThan(0);
  });
});

describe("countdown", () => {
  it("has nothing to show without an expiry", () => {
    expect(countdown(null)).toBe("—");
  });

  it("reads as closed at and past the instant", () => {
    expect(countdown(0)).toBe("closed");
    expect(countdown(-5000)).toBe("closed");
  });

  it("counts days and hours when there is more than a day left", () => {
    expect(countdown((2 * 86400 + 4 * 3600) * 1000)).toBe("2d 04h");
  });

  it("drops to a clock inside the last day", () => {
    expect(countdown((4 * 3600 + 12 * 60 + 8) * 1000)).toBe("04:12:08");
    expect(countdown(3600 * 1000)).toBe("01:00:00");
  });
});