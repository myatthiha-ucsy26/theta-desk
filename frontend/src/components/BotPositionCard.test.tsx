import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTrade, PayoffGrid } from "../lib/api";

const payoff = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, payoff: (body: unknown) => payoff(body) } };
});

import { BotPositionCard } from "./BotPositionCard";

const SPOTS = [90, 95, 100, 105, 110];

/**
 * The same tent the payoff panel is tested against: its differences come out to whole numbers, so
 * the delta and theta below are what the finite-difference code produced, not what the fixture did.
 */
function grid(over: Partial<PayoffGrid> = {}): PayoffGrid {
  return {
    spots: SPOTS,
    days: [30, 29, 0],
    pnl: [
      [-300, -160, -60, -10, 0],
      [-298, -158, -58, -8, 2],
      [-300, -160, -60, -10, 0],
    ],
    breakeven: 101,
    max_profit: 130,
    max_loss: -417,
    spot: 100,
    sigma: 0.33,
    ...over,
  };
}

// The bot's real META put spread as it stood: sold at $1.30, $1.70 to buy back.
const trade: LiveTrade = {
  id: "t1", ticker: "META", direction: "SELL_PUT", expiry: "2026-09-23",
  short_strike: 657.5, long_strike: 652.5, width: 5, contracts: 1,
  planned_credit: 1.3, state: "open", credit: 1.3, tp_order_id: "TP1", tp_tif: "GTC",
  sl_hits: 0, close_price: null, exit_reason: null, close_debit: null, fees: 2.84,
  pnl: null, ai_reason: null, last_ai_check: null,
  opened_at: "2026-09-17T15:23:38+00:00", filled_at: "2026-09-17T15:24:10+00:00", closed_at: null,
};

function renderCard(over: Partial<LiveTrade> = {}, mark = 1.7) {
  return render(
    <ul>
      <BotPositionCard
        trade={{ ...trade, ...over }}
        mark={mark}
        tpPct={50}
        inspecting={false}
        onInspect={() => {}}
      />
    </ul>,
  );
}

/** The figure under a Metric's label, which is the one place the value is rendered. */
function figure(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

beforeEach(() => {
  payoff.mockReset();
  // The card reads today's date to count days to expiry and days held.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("BotPositionCard", () => {
  it("reads the card's figures off the book and the pricer", async () => {
    payoff.mockResolvedValue(grid());
    renderCard();

    // Sold at 1.30, 1.70 to close: 40 cents a share against a 130-dollar max profit.
    await waitFor(() => expect(figure("Delta · net")).toBe("+15"));
    expect(screen.getByText("−$40")).toBeDefined();
    expect(screen.getByText("−30.8%")).toBeDefined();
    expect(figure("Entry → mark")).toBe("$1.30 → $1.70");
    expect(figure("Theta harvest")).toBe("+$2.00/d");

    // The exit level is the book's own rule: half the credit, and twice it for the stop. It is named
    // on the card's own target line; the progress row carries the reading beside its label and does
    // not name the target a second time.
    expect(screen.getByText(/TP target: \$0\.65/)).toBeDefined();
    expect(screen.getByText("Take-profit progress")).toBeDefined();
    expect(screen.getByText(/\(current \$1\.70\)/)).toBeDefined();
    expect(screen.getByText(/Resting GTC order: buy to close @ \$0\.65/)).toBeDefined();

    // (1.30 - 1.70) / (1.30 - 0.65): the mark has travelled 61.5% of the way from the sale price
    // to the buy-back target, in the wrong direction.
    expect(screen.getByText("−61.5% toward trigger")).toBeDefined();
  });

  it("counts the days left and the days held from the trade's own dates", async () => {
    payoff.mockResolvedValue(grid());
    renderCard();

    expect(await screen.findByText(/4 DTE/)).toBeDefined();
    expect(screen.getByText(/entered 1d ago · 4d left/)).toBeDefined();
    expect(screen.getByText(/Exp Sep 23/)).toBeDefined();
  });

  it("spines the card by the side of the bet, and reads it out in words as well", async () => {
    payoff.mockResolvedValue(grid());
    renderCard();

    // Green down the edge for the put side, and the direction written beside the ticker so the
    // colour is repeating a word the card already says rather than carrying the meaning alone.
    const put = screen.getByText("META").closest("li") as HTMLElement;
    expect(put.classList.contains("spine-put")).toBe(true);
    expect(put.classList.contains("spine-call")).toBe(false);
    expect(screen.getByText("Bull put spread")).toBeDefined();
  });

  it("spines a call spread in the other colour", async () => {
    payoff.mockResolvedValue(grid());
    renderCard({ direction: "SELL_CALL" });

    const call = screen.getByText("META").closest("li") as HTMLElement;
    expect(call.classList.contains("spine-call")).toBe(true);
    expect(call.classList.contains("spine-put")).toBe(false);
    expect(screen.getByText("Bear call spread")).toBeDefined();
  });

  it("dashes the greeks alone when the pricer does not come back", async () => {
    payoff.mockRejectedValue(new Error("OpenD is not running"));
    renderCard();

    // The book's own figures are already in hand, so they survive a pricer outage intact.
    await waitFor(() => expect(screen.getByText("−$40")).toBeDefined());
    expect(figure("Delta · net")).toBe("—");
    expect(figure("Theta harvest")).toBe("—");
  });

  it("does not price a spread that never filled", async () => {
    renderCard({ credit: null, state: "entering" });
    payoff.mockResolvedValue(grid());

    // Nothing to price against, so the pricer is never asked and the card claims nothing.
    await waitFor(() => expect(figure("Entry → mark")).toBe("— → $1.70"));
    expect(figure("Delta · net")).toBe("—");
    expect(payoff).not.toHaveBeenCalled();
  });
});