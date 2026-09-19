import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Spread } from "../lib/api";
import { LegCards } from "./LegCards";

const spread: Spread = {
  side: "put", short: 315, long: 310, width: 5, credit: 1.4, max_loss: 360, pop_pct: 70.2,
  short_leg: {
    strike: 315, code: "US.SPY260418P315000", delta: -0.298,
    bid: 1.98, ask: 2.02, iv: 0.215, oi: 14820, volume: 3110,
  },
  long_leg: {
    strike: 310, code: "US.SPY260418P310000", delta: -0.182,
    bid: 0.58, ask: 0.6, iv: 0.23, oi: 22410, volume: 5490,
  },
};

afterEach(cleanup);

/** A leg's own card, found by the role chip that opens it. */
const leg = (role: string) => within(screen.getByText(role).closest("div") as HTMLElement);

describe("LegCards", () => {
  it("names both legs by strike and side", () => {
    render(<LegCards spread={spread} />);
    expect(leg("SHORT").getByText("$315 PUT")).toBeDefined();
    expect(leg("LONG").getByText("$310 PUT")).toBeDefined();
  });

  it("quotes each leg at the bid and ask it was chosen on", () => {
    render(<LegCards spread={spread} />);
    expect(leg("SHORT").getByText("Bid $1.98 / Ask $2.02")).toBeDefined();
    expect(leg("LONG").getByText("Bid $0.58 / Ask $0.60")).toBeDefined();
  });

  it("shows how deep the book is behind each leg", () => {
    render(<LegCards spread={spread} />);
    expect(leg("SHORT").getByText("OI: 14,820 • Vol: 3,110")).toBeDefined();
    expect(leg("LONG").getByText("OI: 22,410 • Vol: 5,490")).toBeDefined();
  });

  it("reads the short's delta and the odds it expires worthless", () => {
    render(<LegCards spread={spread} />);
    expect(leg("SHORT").getByText("Delta: -0.298 • POP: 70.2%")).toBeDefined();
  });

  it("says what the long leg is there for", () => {
    render(<LegCards spread={spread} />);
    expect(leg("LONG").getByText("Delta: -0.182 • Protective tail")).toBeDefined();
  });

  it("leaves the short's note off when the spread carries no POP", () => {
    const { pop_pct: _drop, ...noPop } = spread;
    render(<LegCards spread={noPop} />);
    expect(leg("SHORT").getByText("Delta: -0.298")).toBeDefined();
  });

  it("shows an em dash for a quote OpenD had nothing for", () => {
    // What the backtest's reconstructed legs look like: priced, but never quoted.
    const reconstructed: Spread = {
      ...spread,
      short_leg: { strike: 315, code: null, delta: -0.298, bid: null, ask: null, iv: null, oi: null, volume: null },
    };
    render(<LegCards spread={reconstructed} />);
    expect(leg("SHORT").getByText("Bid — / Ask —")).toBeDefined();
    expect(leg("SHORT").getByText("OI: — • Vol: —")).toBeDefined();
  });

  it("draws nothing for a signal priced before the legs carried their own quotes", () => {
    const { short_leg: _s, long_leg: _l, ...legless } = spread;
    const { container } = render(<LegCards spread={legless} />);
    expect(container.firstChild).toBe(null);
  });
});