import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "../lib/api";

const aiReview = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    signalStreamUrl: (t: string, d: number, m: string[]) =>
      `/api/signal/stream?ticker=${t}&dte=${d}&modes=${m.join(",")}`,
    backtestStreamUrl: (t: string, d: number, m: string[]) =>
      `/api/backtest/stream?ticker=${t}&dte=${d}&modes=${m.join(",")}`,
    aiReview: (t: string, s: unknown) => aiReview(t, s),
    settings: () => Promise.resolve({ dtes: [2, 7, 14] }),
  },
}));

vi.mock("../components/IvSurfacePanel", () => ({
  IvSurfacePanel: ({ ticker, dte }: { ticker: string; dte?: number }) => (
    <div data-testid="iv-surface" data-dte={dte}>
      {ticker}
    </div>
  ),
}));

vi.mock("../components/PayoffSurfacePanel", () => ({
  PayoffSurfacePanel: ({ ticker, contracts }: { ticker: string; contracts: number }) => (
    <div data-testid="payoff-surface">{`${ticker} ${contracts}`}</div>
  ),
}));

import { Study } from "./Study";
import { setTemplate } from "../lib/templates";

type Listener = (ev: { data: string }) => void;

// Stands in for the browser's EventSource so the test can push named events by hand.
class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(payload) });
  }
}

const spySignal: Signal = {
  ticker: "SPY", spot: 471.25, expiration: "2026-09-23", dte: 7, modes: ["ivrich"],
  direction: "SELL_PUT", iv_pct: 32.5, iv_rank: 41.2, iv_rv: 1.15,
  indicators: { rsi: 31, pctb: 0.08, adx: 18, ema20: 470, ema50: 468, last_close: 471.25 },
  verdicts: {
    ivrich: { direction: "SELL_PUT", reason: "IV is rich" },
    meanrev: { direction: "NO_TRADE", reason: "no stretch" },
    trend: { direction: "NO_TRADE", reason: "no trend" },
  },
  spread: {
    side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388,
    pop_pct: 72, breakeven: 468.88, short_delta: -0.3,
    short_leg: {
      strike: 470, code: "US.SPY260923P470000", delta: -0.3,
      bid: 1.98, ask: 2.02, iv: 0.325, oi: 14820, volume: 3110,
    },
    long_leg: {
      strike: 465, code: "US.SPY260923P465000", delta: -0.182,
      bid: 0.58, ask: 0.6, iv: 0.35, oi: 22410, volume: 5490,
    },
  },
};

beforeEach(() => {
  aiReview.mockReset();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  setTemplate("broadsheet");
  vi.unstubAllGlobals();
});

describe("Study", () => {
  it("offers the expiries saved in Settings and runs with the chosen one", async () => {
    render(<Study ticker="SPY" dte="2" />);
    const two = await screen.findByRole("button", { name: "2" });
    expect(two.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    expect(FakeEventSource.last!.url).toContain("dte=2");
  });

  it("shows the log lines and the spread after a signal run", async () => {
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));

    const source = FakeEventSource.last;
    expect(source).not.toBeNull();
    expect(source!.url).toContain("ticker=SPY");

    act(() => {
      source!.emit("log", { step: "data", msg: "Spot: $471.25" });
      source!.emit("log", { step: "ind", msg: "RSI 31.0" });
      source!.emit("result", { data: spySignal });
    });

    expect(await screen.findByText("Bull put")).toBeDefined();
    expect(screen.getByText("$470 / $465")).toBeDefined();
    expect(screen.getByText("Spot: $471.25")).toBeDefined();
    expect(screen.getByText("RSI 31.0")).toBeDefined();
    expect(source!.closed).toBe(true);

    // Both surfaces follow the ticker that ran, not whatever is in the box now.
    expect((await screen.findByTestId("iv-surface")).textContent).toBe("SPY");
    expect(screen.getByTestId("payoff-surface").textContent).toBe("SPY 1");
  });

  it("puts the signal first, right under the controls, and the IV surface last", async () => {
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("log", { step: "data", msg: "Spot: $471.25" });
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    const signal = await screen.findByText("Bull put");
    const payoff = await screen.findByTestId("payoff-surface");
    const log = screen.getByText("Spot: $471.25");
    const iv = await screen.findByTestId("iv-surface");
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(before(signal, payoff)).toBe(true);
    expect(before(payoff, log)).toBe(true);
    expect(before(log, iv)).toBe(true);
  });

  it("breaks the spread down into the two legs it is made of", async () => {
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "SPY" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    const short = within((await screen.findByText("SHORT")).closest("div") as HTMLElement);
    expect(short.getByText("$470 PUT")).toBeDefined();
    expect(short.getByText("Bid $1.98 / Ask $2.02")).toBeDefined();
    expect(short.getByText("OI: 14,820 • Vol: 3,110")).toBeDefined();

    const long = within(screen.getByText("LONG").closest("div") as HTMLElement);
    expect(long.getByText("$465 PUT")).toBeDefined();
    expect(long.getByText("Delta: -0.182 • Protective tail")).toBeDefined();
  });

  it("hands the IV surface the expiry being studied, so its smile reads the same term", async () => {
    render(<Study ticker="SPY" dte="7" />);
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });
    expect((await screen.findByTestId("iv-surface")).getAttribute("data-dte")).toBe("7");
  });

  it("shows the server's message when the run aborts", async () => {
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "SPY" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));

    act(() => {
      FakeEventSource.last!.emit("abort", { msg: "No ATM IV available" });
    });

    expect(await screen.findByText("No ATM IV available")).toBeDefined();
  });
});

describe("Study on the Broadsheet desk", () => {
  it("keeps the same three cards, stacked down the page", async () => {
    setTemplate("broadsheet");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    const [reasoning, spread, review] = ["Signal reasoning", "Credit spread", "AI review"].map(
      (name) => screen.getByRole("heading", { name }),
    );
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(before(reasoning, spread)).toBe(true);
    expect(before(spread, review)).toBe(true);
  });
});

describe("Study in the Minimal template", () => {
  it("runs the same way from the strip, controls above and results tiled below", async () => {
    setTemplate("minimal");
    render(<Study />);

    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("log", { step: "data", msg: "Spot: $471.25" });
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    expect(await screen.findByText("Bull put")).toBeDefined();
    expect(screen.getByText("$470 / $465")).toBeDefined();
    // The controls are a strip of their own, so the signal is not inside the Study panel.
    const controls = screen.getByRole("heading", { name: "Study" }).closest("section");
    expect(controls!.contains(screen.getByText("Bull put"))).toBe(false);
  });

  it("reads the run as three cards: what it saw, what it picked, what the model said", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    const card = (name: string) =>
      screen.getByRole("heading", { name }).closest("section") as HTMLElement;

    // The readings the run turned on — and nothing it went on to price off them.
    const reasoning = card("Signal reasoning");
    expect(within(reasoning).getByText("RSI")).toBeDefined();
    expect(within(reasoning).queryByText("SHORT")).toBeNull();

    const spread = card("Credit spread");
    expect(within(spread).getByText("SHORT")).toBeDefined();
    expect(within(spread).getByText("$112")).toBeDefined();
    expect(within(spread).queryByText("RSI")).toBeNull();

    // Kept apart because it is not part of the run: nothing is asked of the model until pressed.
    expect(within(card("AI review")).getByRole("button", { name: "Ask AI" })).toBeDefined();

    // The three stack in one column, against the surface they describe.
    expect(reasoning.parentElement).toBe(spread.parentElement);
    expect(spread.parentElement).toBe(card("AI review").parentElement);
  });

  it("sets the reasoning against the payoff surface, as two columns of one row", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    const reasoning = (await screen.findByText("Bull put")).closest("section")!.parentElement!;
    const surface = (await screen.findByTestId("payoff-surface")).parentElement!;

    // The surface is read against the strikes it was built from, not four screens below them.
    expect(reasoning.parentElement).toBe(surface.parentElement);
    expect(reasoning.className).toContain("col-span-5");
    expect(surface.className).toContain("col-span-7");
  });

  it("pairs the smile with the backtest under it, seven columns against five", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    act(() => {
      FakeEventSource.last!.emit("result", {
        data: { stats: { n: 12, win_rate: 0.75, expectancy: 64.5, total_pnl: 704 }, trades: [] },
      });
    });

    const smile = (await screen.findByTestId("iv-surface")).parentElement!;
    const backtest = (await screen.findByRole("heading", { name: "Backtest" })).closest("section")!
      .parentElement!;

    expect(smile.parentElement).toBe(backtest.parentElement);
    expect(smile.className).toContain("col-span-7");
    expect(backtest.className).toContain("col-span-5");
  });

  it("gives the reasoning the whole row when the run found no spread to price", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      // A verdict with no spread: nothing for the payoff surface to be built from.
      FakeEventSource.last!.emit("result", { data: { ...spySignal, spread: null } });
    });

    const reasoning = (await screen.findByText("Bull put")).closest("section")!.parentElement!;
    expect(reasoning.className).toContain("col-span-12");
  });

  it("gives the backtest the whole row when no smile ran beside it", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    act(() => {
      FakeEventSource.last!.emit("result", {
        data: { stats: { n: 12, win_rate: 0.75, expectancy: 64.5, total_pnl: 704 }, trades: [] },
      });
    });

    const backtest = (await screen.findByRole("heading", { name: "Backtest" })).closest("section")!
      .parentElement!;

    // Five twelfths of an otherwise empty row reads as a mistake, so it takes all twelve.
    expect(backtest.className).toContain("col-span-12");
  });

  it("gives the short / long pair the whole row rather than a tile it overflows", async () => {
    setTemplate("minimal");
    render(<Study />);
    fireEvent.change(screen.getByLabelText(/Ticker/i), { target: { value: "spy" } });
    fireEvent.click(screen.getByRole("button", { name: "Run signal" }));
    act(() => {
      FakeEventSource.last!.emit("result", { data: spySignal });
    });

    // Two strikes, one tile: at a tile's width the pair runs under the card beside it.
    const pair = (await screen.findByText("$470 / $465")).parentElement as HTMLElement;
    expect(pair.className).toContain("col-span-2");
    expect(pair.className).toContain("sm:col-span-3");
  });
});