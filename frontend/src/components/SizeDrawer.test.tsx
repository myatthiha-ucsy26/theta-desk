import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "../lib/api";

const sizePreview = vi.fn();
const openPaper = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      sizePreview: (ticker: string, signal: unknown) => sizePreview(ticker, signal),
      openPaper: (body: unknown) => openPaper(body),
    },
  };
});

import { SizeDrawer } from "./SizeDrawer";

const signal: Signal = {
  ticker: "SPY", spot: 471.25, expiration: "2026-09-23", dte: 7, modes: ["ivrich"],
  direction: "SELL_PUT", expected_move: 12.4, iv_pct: 32.5, iv_rank: 41.2, iv_rv: 1.15,
  indicators: { rsi: 31, pctb: 0.08, adx: 18, ema20: 470, ema50: 468, last_close: 471.25 },
  verdicts: {
    ivrich: { direction: "SELL_PUT", reason: "IV is rich" },
    meanrev: { direction: "NO_TRADE", reason: "no stretch" },
    trend: { direction: "NO_TRADE", reason: "no trend" },
  },
  spread: {
    side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388,
    pop_pct: 72, breakeven: 468.88, short_delta: -0.3,
  },
};

const preview = {
  ticker: "SPY", contracts: 1, trade_risk: 388, credit_total: 112,
  deployed_before: 750, deployed_after: 1138, cap: 2500,
  open_positions: 1, max_open_positions: 5, ok: true, reason: "",
};

const close = vi.fn();

beforeEach(() => {
  sizePreview.mockReset();
  openPaper.mockReset();
  close.mockReset();
});

afterEach(cleanup);

describe("SizeDrawer", () => {
  it("records a paper trade with the preview's contracts and a study entry context", async () => {
    sizePreview.mockResolvedValue(preview);
    openPaper.mockResolvedValue({});
    render(<SizeDrawer signal={signal} modes={["ivrich"]} aiVerdict={null} onClose={close} />);

    const button = await screen.findByRole("button", { name: "Record paper trade" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(openPaper).toHaveBeenCalledTimes(1));
    const body = openPaper.mock.calls[0][0] as Record<string, unknown>;
    expect(body.contracts).toBe(1);
    expect(body.ticker).toBe("SPY");
    expect(body.direction).toBe("SELL_PUT");
    expect(body.short_strike).toBe(470);
    expect(body.long_strike).toBe(465);
    expect(body.width).toBe(5);
    expect(body.credit).toBe(1.12);
    expect(body.expiry).toBe("2026-09-23");
    expect(body.mode).toBe("ivrich");
    expect((body.entry_context as Record<string, unknown>).source).toBe("study");
    expect(close).toHaveBeenCalled();
  });

  it("blocks the trade and shows the reason when the risk limits say no", async () => {
    sizePreview.mockResolvedValue({
      ...preview, ok: false, reason: "already holding a META position",
    });
    render(<SizeDrawer signal={signal} modes={["ivrich"]} aiVerdict={null} onClose={close} />);

    expect(await screen.findByText("already holding a META position")).toBeDefined();
    expect(screen.getByText("Blocked by risk limits")).toBeDefined();
    const button = screen.getByRole("button", { name: "Record paper trade" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});