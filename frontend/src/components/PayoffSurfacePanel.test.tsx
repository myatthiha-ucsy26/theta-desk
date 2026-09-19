import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PayoffGrid } from "../lib/api";

const payoff = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, payoff: (body: unknown) => payoff(body) } };
});

// three.js does not render in jsdom, and none of the readings below come from it.
vi.mock("./Surface3D", () => ({ Surface3D: () => <div data-testid="surface" /> }));

import { PayoffSurfacePanel } from "./PayoffSurfacePanel";

const SPOTS = [90, 95, 100, 105, 110];

/**
 * A tent-shaped surface whose differences come out to whole numbers, so every figure asserted
 * below is one the finite-difference code produced rather than one the fixture rounded to.
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

/** The grid repriced one vol point higher: only today's row moves, and only at the spot column. */
const bumpedGrid = (atSpot: number) =>
  grid({ pnl: [[-300, -160, atSpot, -10, 0], ...grid().pnl.slice(1)], sigma: 0.34 });

function renderPanel() {
  return render(
    <PayoffSurfacePanel
      direction="SELL_PUT"
      shortStrike={100}
      longStrike={95}
      credit={2}
      contracts={1}
      expiry="2026-10-16"
      ticker="META"
    />,
  );
}

/** The figure under a Metric's label, which is the one place the value is rendered. */
function figure(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

afterEach(cleanup);

describe("PayoffSurfacePanel · sensitivities", () => {
  it("reads the four greeks off the surface as differences of it", async () => {
    payoff.mockResolvedValue(grid());
    renderPanel();

    await waitFor(() => expect(figure("Delta · shares")).toBeDefined());
    // Central differences of today's row about the spot column, three columns apart.
    expect(figure("Delta · shares")).toBe("+15");
    expect(figure("Gamma · shares per $1")).toBe("−2");
    // The row a day nearer expiry is $2 better off at the spot, so decay is in the seller's favour.
    expect(figure("Theta · per day")).toBe("+$2.00");
  });

  it("prices both bumped grids at the spot the first call returned", async () => {
    payoff.mockResolvedValue(grid());
    renderPanel();

    await waitFor(() => expect(payoff).toHaveBeenCalledTimes(3));
    const [base, up, down] = payoff.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(base).not.toHaveProperty("sigma");
    // Without the pin, /api/payoff re-fetches the spot and a tick between calls shifts the grid's
    // own columns out from under the difference.
    expect(up.spot).toBe(100);
    expect(down.spot).toBe(100);
    expect(up.sigma).toBeCloseTo(0.34, 9);
    expect(down.sigma).toBeCloseTo(0.32, 9);
  });

  it("differences the two bumps into a dollar figure per vol point", async () => {
    // $1.00 of P&L across the two bumped grids, which is $1.00 per percentage point of IV.
    payoff.mockImplementation((body: { sigma?: number }) =>
      Promise.resolve(
        body.sigma === undefined ? grid()
          : body.sigma > 0.33 ? bumpedGrid(-61)
          : bumpedGrid(-59),
      ),
    );
    renderPanel();

    await waitFor(() => expect(figure("Vega · per vol point")).toBe("−$1.00"));
    // A reading this small is the reason vega keeps its cents: whole dollars would print −$1.
    expect(screen.queryByText(/Vega is unread/)).toBeNull();
  });

  it("drops vega alone when the bumped grids do not come back", async () => {
    payoff.mockImplementation((body: { sigma?: number }) =>
      body.sigma === undefined
        ? Promise.resolve(grid())
        : Promise.reject(new Error("payoff unavailable")),
    );
    renderPanel();

    // The other three are differences of the grid already in hand, so they survive the failures.
    await waitFor(() => expect(figure("Delta · shares")).toBe("+15"));
    expect(figure("Vega · per vol point")).toBe("—");
    expect(screen.getByText(/Vega is unread/)).toBeDefined();
    expect(screen.queryByText("Payoff unavailable")).toBeNull();
  });
});

describe("PayoffSurfacePanel · spot stress", () => {
  it("reads today's row at each shift of the spot", async () => {
    payoff.mockResolvedValue(grid());
    renderPanel();

    await waitFor(() => expect(figure("Now")).toBeDefined());
    // Each shift is a point on the same row the surface is drawn from, not a reprice.
    expect(figure("−5%")).toBe("−$160");
    expect(figure("−2%")).toBe("−$100");
    expect(figure("Now")).toBe("−$60");
    expect(figure("+2%")).toBe("−$40");
    expect(figure("+5%")).toBe("−$10");
  });
});