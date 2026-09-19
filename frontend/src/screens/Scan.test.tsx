import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, JournalRow, Signal, Stage } from "../lib/api";

const scanLatest = vi.fn();
const journal = vi.fn();
const clearScan = vi.fn();
const settings = vi.fn();
const scanNow = vi.fn();
const engineStatus = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    scanLatest: () => scanLatest(),
    journal: (limit?: number) => journal(limit),
    clearScan: () => clearScan(),
    settings: () => settings(),
    engineStatus: () => engineStatus(),
    scanNow: () => scanNow(),
  },
}));

import { Scan } from "./Scan";
import { setTemplate } from "../lib/templates";

let nextId = 1;

function row(ticker: string, stage: Stage, reason: string, over: Partial<Decision> = {}): JournalRow {
  return {
    id: nextId++,
    ts: "2026-09-16T22:15:00+00:00",
    decision: {
      ticker, dte: 14, modes: ["ivrich"], stage, passed: stage === "alert",
      direction: "SELL_PUT", reason, signal: null, edge: [],
      alert_key: null, ai_verdict: null, ai_reason: null, ...over,
    },
  };
}

const qqqSignal: Signal = {
  ticker: "QQQ", spot: 470, expiration: "2026-09-30", dte: 14, modes: ["ivrich"],
  direction: "SELL_PUT", iv_pct: 0.3, iv_rank: 40,
  verdicts: {
    ivrich: { direction: "SELL_PUT", reason: "IV is rich" },
    meanrev: { direction: "NO_TRADE", reason: "no stretch" },
    trend: { direction: "NO_TRADE", reason: "no trend" },
  },
  spread: { side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388 },
};

// The engine writes the number into the reason as well; the table reads it from the signal.
const ivrichReject = row("GOOGL", "signal", "ivrich: IV rich (IV/RV=1.28) but no mean-rev signal", {
  direction: "NO_TRADE",
  signal: { ...qqqSignal, ticker: "GOOGL", direction: "NO_TRADE", spread: null, iv_rv: 1.28 },
});

// Deliberately out of order: the error first, so sorting has to move QQQ to the top.
const alert = row("QQQ", "alert", "edge ok", { alert_sent: true, signal: qqqSignal });
const failed = row("AAPL", "signal", "error: no ATM IV available");

function setBoard(rows: JournalRow[]) {
  scanLatest.mockResolvedValue(rows);
  journal.mockResolvedValue(rows);
}

/** The engine, idle unless a test says otherwise. */
function setEngine(state: string) {
  engineStatus.mockResolvedValue({ running: true, state, engine_enabled: true, mode: "manual" });
}

beforeEach(() => {
  scanLatest.mockReset();
  journal.mockReset();
  clearScan.mockReset();
  settings.mockReset();
  scanNow.mockReset();
  engineStatus.mockReset();
  clearScan.mockResolvedValue({ cleared: 0 });
  scanNow.mockResolvedValue({ started: true });
  setEngine("idle");
  settings.mockResolvedValue({ watchlist: ["QQQ", "GOOGL", "LULU"], dtes: [7, 14] });
  nextId = 1;
});

afterEach(() => {
  cleanup();
  setTemplate("broadsheet");
});

describe("Scan", () => {
  it("shows how far each row got, with alerts above errors", async () => {
    setBoard([failed, alert]);
    render(<Scan />);

    const table = await screen.findByRole("table");
    // QQQ cleared every gate; AAPL failed the first one.
    expect(within(table).getByRole("img", { name: "Not a repeat: passed" })).toBeDefined();
    expect(within(table).getByRole("img", { name: "Signal: error" })).toBeDefined();

    const order = within(table)
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .filter((t) => t.includes("QQQ") || t.includes("AAPL"))
      .map((t) => (t.includes("QQQ") ? "QQQ" : "AAPL"));
    expect(order).toEqual(["QQQ", "AAPL"]);
  });

  it("shows the number the scan turned on as its own column entry, not inside the reason", async () => {
    setBoard([ivrichReject]);
    render(<Scan />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("IV/RV 1.28")).toBeDefined();
    expect(within(table).getByText("IV rich but no mean-rev signal")).toBeDefined();
  });

  it("names the six gates once, in pipeline order, under the table", async () => {
    setBoard([alert]);
    render(<Scan />);

    await screen.findByRole("table");
    expect(
      screen.getByText(
        "Gates in order: Signal, Spread fits, Backtest edge, Risk limits, AI review, Not a repeat.",
      ),
    ).toBeDefined();
  });

  it("hides the passing rows when Errors is chosen", async () => {
    setBoard([alert, failed]);
    render(<Scan />);

    const table = await screen.findByRole("table");
    fireEvent.click(await screen.findByRole("button", { name: /^Errors/ }));

    expect(within(table).queryByText("QQQ")).toBeNull();
    expect(within(table).getByText("AAPL")).toBeDefined();
  });

  it("tells the person what to do when there is nothing to show", async () => {
    setBoard([]);
    render(<Scan />);

    expect(await screen.findByText(/No scans yet. Press Scan now above/)).toBeDefined();
    // The cycle panel that normally carries the control is not on screen with an empty board, so
    // the board's own head has to keep the manual scan reachable.
    expect(screen.getByRole("button", { name: "Scan now" })).toBeDefined();
  });

  it("clears the board only after the confirm is answered", async () => {
    setBoard([alert]);
    render(<Scan />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(clearScan).toHaveBeenCalledTimes(1);
  });

  it("keeps the board when the confirm is declined", async () => {
    setBoard([alert]);
    render(<Scan />);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(clearScan).not.toHaveBeenCalled();
    expect(within(screen.getByRole("table")).getByText("QQQ")).toBeDefined();
  });

  it("offers no Clear button on an empty board", async () => {
    setBoard([]);
    render(<Scan />);

    await screen.findByText(/No scans yet/);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

/** The cycle panel — which is also where Minimal keeps the board's filters and controls. */
const cyclePanel = async () =>
  (await screen.findByRole("heading", { name: "Engine scan cycle" })).closest("section") as HTMLElement;

/** One figure out of that panel, found by its label rather than by its number: the filter pills
    in the same panel carry counts too, so the bare digits are no longer unique. */
const figure = (panel: HTMLElement, label: string) =>
  within(within(panel).getByText(label).parentElement as HTMLElement);

describe("Scan in the Minimal template", () => {
  it("sets the decisions as a feed of cards, keeping every gate", async () => {
    setTemplate("minimal");
    setBoard([alert]);

    render(<Scan />);

    const gate = await screen.findByRole("img", { name: "Not a repeat: passed" });
    // The row is a card in a list now, not a row in a table, and the gates came with it.
    expect(gate.closest("li")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByText(
        "Gates in order: Signal, Spread fits, Backtest edge, Risk limits, AI review, Not a repeat.",
      ),
    ).toBeDefined();
  });

  it("leads with the pipeline strip, one tile per gate", async () => {
    setTemplate("minimal");
    setBoard([alert, ivrichReject]);

    render(<Scan />);

    const strip = (await screen.findByRole("heading", { name: "Pipeline" })).closest("section")!;
    const tiles = within(strip).getAllByRole("listitem");
    expect(tiles).toHaveLength(6);
    // QQQ cleared every gate and GOOGL stopped at the first, so the strip reads 1 of 2 through.
    expect(within(tiles[0]).getByText("1/2 through · 1 stopped")).toBeDefined();
    expect(within(tiles[0]).getByText("50%")).toBeDefined();
    // Only QQQ got past the signal gate, so the last gate is thin rather than empty.
    expect(within(tiles[5]).getByText("1/1 through")).toBeDefined();
  });

  it("leads with the cycle it is reading: how many tickers, what is watched, what cleared", async () => {
    setTemplate("minimal");
    setBoard([alert, ivrichReject]);

    render(<Scan />);

    const cycle = await cyclePanel();
    expect(figure(cycle, "tickers logged").getByText("2")).toBeDefined();
    // Watchlist and expiries come from Settings, not from the board.
    expect(figure(cycle, "Watchlist").getByText("3 tickers")).toBeDefined();
    expect(figure(cycle, "Expiries").getByText("2 DTEs (7d, 14d)")).toBeDefined();
    // One row (QQQ) came through every gate; GOOGL never left the first.
    expect(figure(cycle, "Cleared all six gates").getByText("1")).toBeDefined();
  });

  it("carries the board's filters and its two controls in the cycle panel", async () => {
    setTemplate("minimal");
    setBoard([alert, failed]);

    render(<Scan />);

    const cycle = await cyclePanel();
    expect(within(cycle).getByRole("button", { name: /^Errors/ })).toBeDefined();
    expect(within(cycle).getByRole("button", { name: "Scan now" })).toBeDefined();
    expect(within(cycle).getByRole("button", { name: "Clear" })).toBeDefined();

    // The board below keeps the rows, and nothing else.
    const board = screen.getByRole("heading", { name: "Scan" }).closest("section") as HTMLElement;
    expect(within(board).queryByRole("button", { name: /^Errors/ })).toBeNull();
    expect(within(board).queryByRole("button", { name: "Clear" })).toBeNull();
    expect(within(board).queryByRole("button", { name: "Scan now" })).toBeNull();
  });

  it("filters the feed from up there", async () => {
    setTemplate("minimal");
    setBoard([alert, failed]);

    render(<Scan />);

    fireEvent.click(within(await cyclePanel()).getByRole("button", { name: /^Errors/ }));

    const board = screen.getByRole("heading", { name: "Scan" }).closest("section") as HTMLElement;
    expect(within(board).queryByText("QQQ")).toBeNull();
    expect(within(board).getByText("AAPL")).toBeDefined();
  });

  it("asks the engine for a cycle from the panel", async () => {
    setTemplate("minimal");
    setBoard([alert]);

    render(<Scan />);

    fireEvent.click(within(await cyclePanel()).getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(scanNow).toHaveBeenCalledTimes(1));
  });

  it("ripples and sweeps while a cycle is running", async () => {
    setTemplate("minimal");
    setBoard([alert]);
    setEngine("scanning");

    render(<Scan />);

    const cycle = await cyclePanel();
    expect(within(cycle).getByText("Scanning")).toBeDefined();
    expect(cycle.querySelector(".scan-dot-live")).not.toBeNull();
    expect(cycle.querySelector(".scan-sweep")).not.toBeNull();
  });

  it("holds both animations still once the engine is idle again", async () => {
    setTemplate("minimal");
    setBoard([alert]);

    render(<Scan />);

    const cycle = await cyclePanel();
    expect(within(cycle).getByText("Waiting for next cycle")).toBeDefined();
    expect(cycle.querySelector(".scan-dot-live")).toBeNull();
    expect(cycle.querySelector(".scan-sweep")).toBeNull();
  });

  it("leaves the cycle panel, and so the controls, off an empty board", async () => {
    setTemplate("minimal");
    setBoard([]);

    render(<Scan />);

    await screen.findByText(/No scans yet/);
    expect(screen.queryByRole("heading", { name: "Engine scan cycle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("puts the engine journal in the rail, beside the board rather than under it", async () => {
    setTemplate("minimal");
    setBoard([alert, ivrichReject]);

    render(<Scan />);

    const log = (await screen.findByRole("heading", { name: "Engine journal" })).closest("section")!;
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);

    // Same column as the panel it reads with, so the cycle is watchable without scrolling past
    // the whole board to reach it.
    const rail = screen.getByRole("heading", { name: "Setup quick-inspect" }).closest("section")!;
    expect(log.parentElement).toBe(rail.parentElement);
  });

  it("opens the top row in the rail, then follows a click on another", async () => {
    setTemplate("minimal");
    setBoard([alert, ivrichReject]);

    render(<Scan />);

    const rail = (await screen.findByRole("heading", { name: "Setup quick-inspect" })).closest(
      "section",
    )!;
    // Alerts sort above rejections, so QQQ is open before anything is clicked.
    expect(within(rail).getByRole("heading", { name: "QQQ" })).toBeDefined();
    expect(within(rail).getByText("$1.12")).toBeDefined();

    // GOOGL never got a spread, so the rail says so rather than showing a made-up credit.
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("GOOGL"))!);

    expect(within(rail).getByRole("heading", { name: "GOOGL" })).toBeDefined();
    expect(within(rail).getByText("No spread")).toBeDefined();
  });
});

describe("Scan on the Broadsheet desk", () => {
  // The desk keeps its own board and its own filter row, but it now carries the same engine cycle
  // and pipeline panels the terminal does: the cycles the engine has run and the gate funnel had no
  // other way to show on this page.
  it("carries the cycle and pipeline panels, and one set of scan controls", async () => {
    setTemplate("broadsheet");
    setBoard([alert]);

    render(<Scan />);

    await screen.findByRole("table");
    expect(screen.getByRole("heading", { name: "Engine scan cycle" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Pipeline" })).toBeDefined();
    // The filter row belongs to the board here, so folding it into the engine panel as well would
    // print the same four controls twice.
    expect(screen.getAllByRole("button", { name: /^Alerts/ })).toHaveLength(1);
  });
});