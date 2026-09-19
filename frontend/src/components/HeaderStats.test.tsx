import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalRow } from "../lib/api";

const TICKERS = ["AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "PLTR", "QQQ", "SPY"];

function row(ticker: string, spot: number): JournalRow {
  return {
    id: 1,
    ts: "2026-09-16T16:07:00+00:00",
    decision: {
      ticker, dte: 14, modes: ["ivrich"], stage: "signal", passed: false, direction: "NO_TRADE",
      reason: "r", signal: { spot } as JournalRow["decision"]["signal"], edge: [],
      alert_key: null, ai_verdict: null, ai_reason: null,
    },
  };
}

vi.mock("../lib/api", () => ({
  api: {
    scanLatest: () => Promise.resolve(TICKERS.map((t, i) => row(t, 100 + i))),
    paper: () => Promise.reject(new Error("unused")),
    settings: () => Promise.reject(new Error("unused")),
    account: () => Promise.resolve({
      net_value: 25310.4, cash: 18000.25, buying_power: 36000.5, unrealized_pl: 120, open_count: 2, currency: "USD",
    }),
  },
}));

import { StatCards, TickerStrip } from "./HeaderStats";

afterEach(cleanup);

describe("TickerStrip", () => {
  it("lists every ticker exactly once for assistive technology", async () => {
    render(<TickerStrip />);
    for (const t of TICKERS) {
      const visible = (await screen.findAllByText(t)).filter((el) => !el.closest('[aria-hidden="true"]'));
      expect(visible).toHaveLength(1);
    }
  });

  it("has no scrollbar-producing overflow on the strip", async () => {
    const { container } = render(<TickerStrip />);
    await screen.findAllByText("AAPL");
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });
});

describe("StatCards", () => {
  it("shows the real moomoo account next to the paper book, each labelled", async () => {
    render(<StatCards />);
    expect(await screen.findByText("$25,310")).toBeTruthy();
    expect(screen.getByText("+$120")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Paper book" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Real account · moomoo" })).toBeTruthy();
  });
});
