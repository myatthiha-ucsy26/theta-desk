import { describe, expect, it } from "vitest";
import type { Account, Decision, JournalRow, PaperBook } from "./api";
import { accountCards, latestSpots, marqueeSeconds, shouldScroll, statCards } from "./header";

function row(id: number, ts: string, ticker: string, spot: number | null): JournalRow {
  const decision = {
    ticker, dte: 7, modes: [], stage: "signal", passed: false, direction: null, reason: "",
    signal: spot === null ? null : { ticker, spot },
    edge: [], alert_key: null, ai_verdict: null, ai_reason: null,
  } as unknown as Decision;
  return { id, ts, decision };
}

describe("latestSpots", () => {
  it("keeps the newest spot per ticker, in ticker order", () => {
    const rows = [
      row(1, "2026-09-16T13:00:00Z", "SPY", 580),
      row(2, "2026-09-16T14:00:00Z", "SPY", 581.4),
      row(3, "2026-09-16T13:30:00Z", "AAPL", 228.12),
    ];
    expect(latestSpots(rows)).toEqual([
      { ticker: "AAPL", spot: 228.12, ts: "2026-09-16T13:30:00Z" },
      { ticker: "SPY", spot: 581.4, ts: "2026-09-16T14:00:00Z" },
    ]);
  });

  it("skips decisions without a signal", () => {
    expect(latestSpots([row(1, "2026-09-16T13:00:00Z", "QQQ", null)])).toEqual([]);
  });
});

const book: PaperBook = {
  open: [],
  closed: [],
  stats: { total_pnl: 412.5, wins: 9, losses: 3, win_rate: 0.75, open_count: 2, deployed_risk: 1500, risk_cap: 2000 },
};

describe("statCards", () => {
  it("builds the four cards from the paper book and the position limit", () => {
    const cards = statCards(book, 5);
    expect(cards.map((c) => c.label)).toEqual(["Realised P&L", "Win rate", "Open positions", "Risk deployed"]);
    expect(cards[0]).toMatchObject({ value: "+$413", tone: "profit" });
    expect(cards[1]).toMatchObject({ value: "75.0%", note: "9 wins / 3 losses", meter: 75 });
    expect(cards[2]).toMatchObject({ value: "2", note: "of 5 allowed", meter: 40 });
    expect(cards[3]).toMatchObject({ value: "$1,500", note: "of $2,000 cap", meter: 75, over: false });
  });

  it("marks a loss and an over-cap book", () => {
    const cards = statCards({ ...book, stats: { ...book.stats, total_pnl: -80, deployed_risk: 2500 } }, 5);
    expect(cards[0]).toMatchObject({ value: "−$80", tone: "loss" });
    expect(cards[3]).toMatchObject({ meter: 100, over: true });
  });

  it("shows placeholders before anything has loaded", () => {
    const cards = statCards(null, null);
    expect(cards.every((c) => c.value === "—")).toBe(true);
  });
});

describe("accountCards", () => {
  const account: Account = { account: "live", net_value: 25310.4, cash: 18000.25, buying_power: 36000.5, unrealized_pl: -80.5, open_count: 3, currency: "USD",
  };

  it("builds the two real-account cards", () => {
    const cards = accountCards(account);
    expect(cards.map((c) => c.label)).toEqual(["Net value", "Unrealised P&L"]);
    expect(cards[0]).toMatchObject({ value: "$25,310" });
    expect(cards[1]).toMatchObject({ value: "\u2212$81", tone: "loss", note: "3 open positions" });
  });

  it("shows placeholders when the account is not loaded", () => {
    expect(accountCards(null).every((c) => c.value === "\u2014")).toBe(true);
  });
});

describe("marqueeSeconds", () => {
  it("never loops faster than 20 seconds", () => {
    expect(marqueeSeconds(0)).toBe(20);
    expect(marqueeSeconds(5)).toBe(20);
  });

  it("keeps the same speed as the watchlist grows: 4 seconds per ticker", () => {
    expect(marqueeSeconds(10)).toBe(40);
    expect(marqueeSeconds(30)).toBe(120);
  });
});

describe("shouldScroll", () => {
  it("only scrolls when one copy of the list is wider than the space", () => {
    expect(shouldScroll(900, 1000)).toBe(false);
    expect(shouldScroll(1000, 1000)).toBe(false);
    expect(shouldScroll(1001, 1000)).toBe(true);
  });
});
