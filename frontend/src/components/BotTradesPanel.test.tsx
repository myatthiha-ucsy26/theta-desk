import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const open = {
  id: "a", ticker: "SPY", direction: "SELL_PUT", expiry: "2026-09-30", short_strike: 731, long_strike: 726,
  width: 5, contracts: 1, planned_credit: 0.6, state: "open", credit: 0.6, tp_order_id: "o2", tp_tif: "GTC",
  sl_hits: 0, close_price: null, exit_reason: null, close_debit: null, fees: 1, pnl: null, ai_reason: "calm",
  last_ai_check: "2026-09-16T15:00:00+00:00", opened_at: "2026-09-16T14:50:00+00:00",
  filled_at: "2026-09-16T14:51:00+00:00", closed_at: null,
};
const closed = { ...open, id: "b", ticker: "QQQ", state: "closed", exit_reason: "tp", close_debit: 0.31, pnl: 28, closed_at: "2026-09-15T18:00:00+00:00" };
const closeAllBot = vi.fn(() => Promise.resolve({ closing: 1 }));

vi.mock("../lib/api", () => ({
  api: {
    settings: () => Promise.resolve({ tp_pct: 50, sl_multiple: 2 }),
    bot: () => Promise.resolve({ mode: "auto", paused: false, pause_reason: "", monitor: { state: "watching", last_ok: null, last_error: null },
      net_pnl: 28, slots: 1, next_slot_at: 500, active: [open], closed: [closed], marks: { a: 0.45 },
      events: [{ id: 1, ts: "2026-09-16T14:51:00+00:00", trade_id: "a", action: "entry_filled", order_id: "o1", price: 0.6, status: "filled", reason: null }] }),
    // The card reads a greek off the pricer's grid; the panel test only needs it to come back.
    payoff: () => Promise.resolve({ spots: [90, 95, 100, 105, 110], days: [30, 29, 0],
      pnl: [[-300, -160, -60, -10, 0], [-298, -158, -58, -8, 2], [-300, -160, -60, -10, 0]],
      breakeven: 101, max_profit: 130, max_loss: -417, spot: 100, sigma: 0.33 }),
    closeAllBot: () => closeAllBot(),
  },
}));

import { BotTradesPanel } from "./BotTradesPanel";
import { api } from "../lib/api";
import { setTemplate } from "../lib/templates";
import { usePoll } from "../lib/usePoll";

/** The panel takes the live book as a prop, so the test supplies it the way Manage does. */
function Harness() {
  const [selected, setSelected] = useState<string | null>(null);
  return <BotTradesPanel bot={usePoll(() => api.bot(), 60000)} selected={selected} onSelect={setSelected} />;
}

afterEach(() => {
  cleanup();
  // The template lives in module state, so a test that switches it must switch it back.
  setTemplate("broadsheet");
});

describe("BotTradesPanel", () => {
  it("shows open spreads with cost to close and exit levels", async () => {
    render(<Harness />);
    expect(await screen.findByText("SPY")).toBeTruthy();
    expect(screen.getByText("$0.45")).toBeTruthy();                 // cost to close now
    expect(screen.getByText("TP $0.30 · SL $1.80")).toBeTruthy();
  });

  it("lists closed spreads with exit reason and P&L, and the order log", async () => {
    render(<Harness />);
    expect(await screen.findByText("Take profit")).toBeTruthy();
    expect(screen.getByText("+$28")).toBeTruthy();
    expect(screen.getByText("entry_filled")).toBeTruthy();
  });

  it("closes everything only after a second click", async () => {
    render(<Harness />);
    await screen.findByText("SPY");
    fireEvent.click(screen.getByRole("button", { name: "Close all bot positions" }));
    expect(closeAllBot).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, close all at market" }));
    });
    expect(closeAllBot).toHaveBeenCalledOnce();
  });

  it("sets each open spread as a card in the terminal template", async () => {
    setTemplate("minimal");
    render(<Harness />);
    await screen.findByText("SPY");

    // The table and its column are gone together, and the card stands where the row was.
    expect(screen.queryByText("AI checked")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect 3D payoff" })).toBeTruthy();

    // Sold at 0.60, 0.45 to buy back: 15 dollars of a 60-dollar max profit, and the mark is
    // halfway from the sale price to the 0.30 buy-back target.
    expect(await screen.findByText("+$15")).toBeTruthy();
    expect(screen.getByText("50.0% toward trigger")).toBeTruthy();
  });

  it("keeps the table in the broadsheet template", async () => {
    render(<Harness />);
    expect(await screen.findByText("AI checked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inspect 3D payoff" })).toBeNull();

    // The card carries the payoff as a button of its own; a table has no room for one per row, so
    // the desk opens it off the ticker — the idiom the paper book's table already uses.
    const ticker = screen.getByRole("button", { name: "SPY" });
    expect(ticker.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ticker);
    expect(ticker.getAttribute("aria-pressed")).toBe("true");
  });

  it("hands the close-all to the controller in the terminal template", async () => {
    setTemplate("minimal");
    render(<Harness />);
    await screen.findByText("SPY");

    // Manage's controller carries the emergency exit there, and one book needs one button that
    // closes it. The head counts both books instead, so the panel still says what it is holding.
    expect(screen.queryByRole("button", { name: "Close all bot positions" })).toBeNull();
    expect(screen.getByText("1 live · 1 closed")).toBeTruthy();
  });

  it("leaves the order log to the rail in the terminal template", async () => {
    setTemplate("minimal");
    render(<Harness />);
    await screen.findByText("SPY");

    // Manage's dock sets the feed out beside the controls; one order is logged once.
    expect(screen.queryByText("entry_filled")).toBeNull();
  });

  it("sets a closed spread as a card in the terminal template", async () => {
    setTemplate("minimal");
    render(<Harness />);
    await screen.findByText("SPY");

    // Both books are the same card here, so the panel holds no table at all — the closed one runs
    // the prices the trade went through at where the open one runs its greeks.
    const panel = screen.getByRole("heading", { name: "Bot trades" }).closest("section") as HTMLElement;
    expect(within(panel).queryByRole("table")).toBeNull();

    const card = within(panel).getByText("QQQ").closest("li") as HTMLElement;
    const at = (label: string) => within(card).getByText(label).closest("div") as HTMLElement;
    expect(within(at("Contracts")).getByText("1")).toBeTruthy();
    expect(within(at("Sold at")).getByText("$0.60")).toBeTruthy();
    expect(within(at("Bought back")).getByText("$0.31")).toBeTruthy();
    expect(within(at("Exit")).getByText("Take profit")).toBeTruthy();
    expect(within(at("Realised P&L")).getByText("+$28")).toBeTruthy();
  });

  it("filters the two books apart from the panel head", async () => {
    setTemplate("minimal");
    render(<Harness />);
    await screen.findByText("SPY");

    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(screen.queryByRole("button", { name: "Inspect 3D payoff" })).toBeNull();
    expect(screen.getByText("Take profit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByText("Take profit")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect 3D payoff" })).toBeTruthy();

    // All is the default, so nothing is hidden until the control is used.
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Take profit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect 3D payoff" })).toBeTruthy();
  });
});
