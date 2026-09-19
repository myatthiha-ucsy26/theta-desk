import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, BotStatus, LiveTrade, OpenPosition, PaperBook, Position } from "../lib/api";

const paper = vi.fn();
const closePaper = vi.fn();
const bot = vi.fn();
const account = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      paper: () => paper(),
      closePaper: (id: string) => closePaper(id),
      bot: () => bot(),
      account: () => account(),
      // The cards read their greeks off the pricer; these tests are about the screen's own
      // figures, so it stays unreadable and the cards dash that one reading.
      settings: () => Promise.reject(new Error("offline")),
      payoff: () => Promise.reject(new Error("offline")),
    },
  };
});

vi.mock("../components/PayoffSurfacePanel", () => ({
  PayoffSurfacePanel: () => <div data-testid="payoff-surface" />,
}));

import { Manage } from "./Manage";
import { setTemplate } from "../lib/templates";

const open: OpenPosition = {
  id: "pt_1", ticker: "META", direction: "SELL_PUT", short_strike: 700, long_strike: 695,
  width: 5, credit: 1.5, contracts: 1, entry_date: "2026-09-15", expiry: "2026-09-26",
  mode: "ivrich", status: "open", close_date: null, close_pnl: null, entry_context: null,
  spot: 712.4, mtm_pnl: 62, days_left: 10, max_profit: 150, risk: 350,
  distance_pct: 1.7468, short_breached: false, profit_pct: 41.33, profit_take_hit: true,
};

const closed: Position = {
  id: "pt_0", ticker: "LULU", direction: "SELL_CALL", short_strike: 104, long_strike: 109,
  width: 5, credit: 0.78, contracts: 1, entry_date: "2026-09-15", expiry: "2026-09-18",
  mode: "trend", status: "closed", close_date: "2026-09-15", close_pnl: 78,
  entry_context: null,
};

const book: PaperBook = {
  open: [open],
  closed: [closed],
  stats: {
    total_pnl: 78, wins: 1, losses: 0, win_rate: 1,
    open_count: 1, deployed_risk: 350, risk_cap: 2500,
  },
};

// The bot's real META put spread: sold at $1.30, $1.42 to buy back, on a $2,500 account. The
// exposure matrix reads this book, not the paper one above, so the two disagree on purpose.
const live: LiveTrade = {
  id: "t1", ticker: "META", direction: "SELL_PUT", expiry: "2026-09-23",
  short_strike: 657.5, long_strike: 652.5, width: 5, contracts: 1,
  planned_credit: 1.3, state: "open", credit: 1.3, tp_order_id: "TP1", tp_tif: "GTC",
  sl_hits: 0, close_price: null, exit_reason: null, close_debit: null, fees: 2.84,
  pnl: null, ai_reason: null, last_ai_check: null,
  opened_at: "2026-09-17T15:23:38+00:00", filled_at: "2026-09-17T15:24:10+00:00", closed_at: null,
};

const liveBook: BotStatus = {
  mode: "manual", account_mode: "paper", paused: true, pause_reason: "stopped by you",
  monitor: { state: "ok", last_ok: null, last_error: null },
  net_pnl: 0, slots: 4, next_slot_at: 2000,
  active: [live],
  closed: [],
  marks: { t1: 1.42 },
  events: [],
};

const liveAccount: Account = { account: "live", net_value: 2500, cash: 900, buying_power: 4000,
  unrealized_pl: 48, open_count: 4, currency: "USD",
};

beforeEach(() => {
  paper.mockReset();
  closePaper.mockReset();
  bot.mockReset();
  account.mockReset();
  // The cockpit's own panels are covered by their own tests; these default the two polls the
  // exposure matrix reads to unreadable, so the tests below start from an empty cockpit.
  bot.mockRejectedValue(new Error("offline"));
  account.mockRejectedValue(new Error("offline"));
});

afterEach(() => {
  cleanup();
  setTemplate("broadsheet");
});

describe("Manage", () => {
  it("flags a position that has reached the profit target", async () => {
    paper.mockResolvedValue(book);
    render(<Manage />);

    expect(await screen.findByText("Take profit (50% reached)")).toBeDefined();
  });

  it("closes a position only after the inline confirm", async () => {
    paper.mockResolvedValue(book);
    closePaper.mockResolvedValue({ ...open, status: "closed" });
    render(<Manage />);

    fireEvent.click(await screen.findByRole("button", { name: "Close position" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm close at current price" }));

    await waitFor(() => expect(closePaper).toHaveBeenCalledWith("pt_1"));
  });

  it("warns when deployed risk is over the cap", async () => {
    paper.mockResolvedValue({
      ...book,
      stats: { ...book.stats, deployed_risk: 3000, risk_cap: 2500 },
    });
    render(<Manage />);

    expect(await screen.findByText("Over the risk cap")).toBeDefined();
  });
});

describe("Manage · portfolio exposure", () => {
  it("summarises the bot's live book, not the paper one", async () => {
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    // $1.30 over 100 shares against a 5-wide spread the broker holds in full, on a $2,500 account.
    expect(await screen.findByText("Credit deployed")).toBeDefined();
    expect(screen.getByText("$130")).toBeDefined();
    expect(screen.getByText("Margin committed")).toBeDefined();
    expect(screen.getByText("$500")).toBeDefined();
    expect(screen.getByText("20.0%")).toBeDefined();

    // Sold at 1.30, 1.42 to close: 12 cents a share against the position.
    expect(screen.getByText("−$12")).toBeDefined();

    // The paper book holds a META spread too, and the matrix must not be reading it: reading that
    // one would put its $150 of credit here, and nothing else on the page says $150.
    expect(screen.queryByText("$150")).toBeNull();
  });

  it("counts down to the forced close at the nearest expiry", async () => {
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    expect(await screen.findByText("Expiry Sep 23")).toBeDefined();
    expect(screen.getByText(/until the bot force-closes 1 spread at 3:00 PM New York/)).toBeDefined();
  });

  it("leaves NAV usage blank rather than guessing when the account is unreadable", async () => {
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    render(<Manage />);

    // The other eight figures come off the book and survive; only this one needs net value.
    expect(await screen.findByText("Margin committed")).toBeDefined();
    // Read through the label, because the bot's own table below renders a dash of its own.
    expect(screen.getByText("NAV usage").nextElementSibling?.textContent).toBe("—");
  });

  it("reports why the live book could not be read instead of showing zeros", async () => {
    paper.mockResolvedValue(book);
    bot.mockRejectedValue(new Error("OpenD is not running"));
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    // Without the book there is nothing to total, so the reason stands where the figures would be.
    // Showing nine zeros here would read as a flat book rather than an unreadable one. The bot's
    // own table below reports the same failure, so it lands twice on the page.
    expect(await screen.findAllByText("OpenD is not running")).toHaveLength(2);
    expect(screen.queryByText("Credit deployed")).toBeNull();
  });

  it("says the live book is loading until its first read lands", async () => {
    paper.mockResolvedValue(book);
    // A read that never settles is the only way to hold the cockpit in its first-load state.
    bot.mockReturnValue(new Promise<never>(() => {}));
    render(<Manage />);

    expect(await screen.findByText("Loading the live book…")).toBeDefined();
    expect(screen.queryByText("Credit deployed")).toBeNull();
  });
});

describe("Manage in the Minimal template", () => {
  it("sets each open position as a card of labelled figures, and the closed book the same way", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    render(<Manage />);

    expect(await screen.findByText("Take profit (50% reached)")).toBeDefined();

    // Sold at 1.50 and 0.88 to buy back -- which is the 62 dollars of P&L divided back out of a
    // 150-dollar max profit -- and the mark has come 82.7% of the way to the 0.75 buy-back target.
    expect(screen.getByText("Paper trade, ivrich — no order is resting.")).toBeDefined();
    expect(screen.getByText("+$62")).toBeDefined();
    expect(screen.getByText("41.3%")).toBeDefined();
    expect(screen.getByText("82.7% toward trigger")).toBeDefined();

    // The card labels its figures where the table headed them, so they land on <dt>.
    for (const label of ["Entry → mark", "Delta · net", "Theta harvest", "Realised P&L"]) {
      expect(screen.getAllByText(label).every((el) => el.tagName === "DT")).toBe(true);
    }
  });

  it("still closes a position from the card, on the same inline confirm", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    closePaper.mockResolvedValue({ ...open, status: "closed" });
    render(<Manage />);

    fireEvent.click(await screen.findByRole("button", { name: "Close position" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm close at current price" }));

    await waitFor(() => expect(closePaper).toHaveBeenCalledWith("pt_1"));
  });

  it("reads the book as four tiles, each carrying its own second reading", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    // Nine ruled rows in one column are a ledger; four tiles, each with the figure that explains
    // it underneath, are a cockpit. The second readings are the ones the ninth row carried.
    const tile = (label: string) =>
      screen.getByText(label).closest(".stat-card") as HTMLElement;

    expect(await screen.findByText("Credit deployed")).toBeDefined();
    expect(within(tile("Credit deployed")).getByText("$130")).toBeDefined();
    expect(within(tile("Credit deployed")).getByText("1 active contract")).toBeDefined();
    expect(within(tile("Margin committed")).getByText("$500")).toBeDefined();
    expect(within(tile("Margin committed")).getByText("NAV usage 20.0%")).toBeDefined();
    // Sold at 1.30, 1.42 to close: 12 cents a share against the position, which is 9.2% of the
    // credit it is being earned against.
    expect(within(tile("Unrealised P&L")).getByText("−$12")).toBeDefined();
    expect(within(tile("Unrealised P&L")).getByText("−9.2% of credit captured")).toBeDefined();
    expect(within(tile("Win rate")).getByText("0.0%")).toBeDefined();
    expect(within(tile("Win rate")).getByText("0 / 0 closed")).toBeDefined();
  });

  it("names the risk cap on the panel head rather than under the meter", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    render(<Manage />);

    const panel = (await screen.findByRole("heading", { name: "Portfolio exposure" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(panel).getByText("Risk cap $2,500")).toBeDefined();
  });
});

describe("Manage in the Minimal template · execution controller", () => {
  it("reads the bot's own state: entries, mode, monitor and slots", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    const panel = (
      await screen.findByRole("heading", { name: "Execution controller" })
    ).closest("section") as HTMLElement;

    // Every reading here is the bot's own: it is paused by you, its monitor is up, it holds one of
    // the four slots its net profit has bought, and the next one opens at $2,000. The rail sets
    // them as ruled key/value rows, so a reading is the row its label heads.
    const row = (label: string) => within(panel).getByText(label).closest("div") as HTMLElement;

    expect(within(row("Entries")).getByText("Paused")).toBeDefined();
    expect(within(row("Entries")).getByText("stopped by you")).toBeDefined();
    expect(within(row("Mode")).getByText("manual")).toBeDefined();
    expect(within(row("Monitor")).getByText("ok")).toBeDefined();
    expect(within(row("Slots")).getByText("1 of 4")).toBeDefined();
    expect(within(row("Slots")).getByText("next slot at $2,000")).toBeDefined();

    // The badge says the bot takes no entries of its own, which is what "manual" means here —
    // pause is only a state the bot can be in once it is armed.
    expect(within(panel).getByText("Bot off")).toBeDefined();

    // Closing the book is the one control the rail keeps: the folio line stops and resumes entries
    // on every screen, but nothing else can close what the bot is holding.
    expect(within(panel).getByRole("button", { name: "Emergency exit" })).toBeDefined();
  });

  it("keeps the only close control on the controller", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    expect(await screen.findByRole("button", { name: "Emergency exit" })).toBeDefined();

    // The bot's own panel below lists what is open; it does not also carry a button that closes
    // it. Two buttons for one action is one too many, and the real one is the rail's.
    expect(screen.queryByRole("button", { name: "Close all bot positions" })).toBeNull();
  });

  it("says how much is in each book on that book's panel head", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockResolvedValue(liveBook);
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    const at = async (heading: string) =>
      (await screen.findByRole("heading", { name: heading })).closest("section") as HTMLElement;

    // Three panels hold three different books: one paper spread still open, one bot spread open
    // with nothing closed yet, one paper spread closed. Each head counts its own.
    expect(within(await at("Open positions")).getByText("1 paper")).toBeDefined();
    expect(within(await at("Bot trades")).getByText("1 live · 0 closed")).toBeDefined();
    expect(within(await at("Closed trades")).getByText("1 closed")).toBeDefined();
  });

  it("sets the bot's order feed in the rail, under its controls", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockResolvedValue({
      ...liveBook,
      events: [
        {
          id: 1, ts: "2026-09-17T15:24:10+00:00", trade_id: "t1", action: "entry_filled",
          order_id: "o1", price: 1.3, status: "filled", reason: null,
        },
      ],
    });
    account.mockResolvedValue(liveAccount);
    render(<Manage />);

    const log = (await screen.findByRole("heading", { name: "Order log" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(log).getByText("1 order")).toBeDefined();
    expect(within(log).getByText("entry_filled")).toBeDefined();
    expect(within(log).getByText("filled")).toBeDefined();

    // One log, in the dock: what the bot sent belongs beside the switch that stops it, not folded
    // away under the list of what it bought.
    expect(screen.getAllByText("entry_filled")).toHaveLength(1);
  });

  it("stands the controller down when the live book cannot be read", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(book);
    bot.mockRejectedValue(new Error("OpenD is not running"));
    render(<Manage />);

    // The exposure panel above already reports the failure; a second copy of it here would read
    // as two separate faults. The bot's own panel below reports it too, which is where the pair
    // on the page comes from.
    expect(await screen.findAllByText("OpenD is not running")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Execution controller" })).toBeNull();
  });
});