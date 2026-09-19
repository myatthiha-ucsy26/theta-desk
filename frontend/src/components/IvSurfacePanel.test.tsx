import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ivSurface = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, ivSurface: (t: string, r?: boolean) => ivSurface(t, r) } };
});

// The canvas needs WebGL, which jsdom cannot provide; the table is the testable path.
vi.mock("./SurfaceCanvas", () => ({ default: () => <div data-testid="surface-canvas" /> }));

import { ApiError } from "../lib/api";
import { IvSurfacePanel } from "./IvSurfacePanel";

const surface = {
  ticker: "SPY", spot: 471.25,
  expiries: ["2026-09-23", "2026-09-30"], dtes: [7, 14],
  strikes: [465, 470, 475],
  iv: [[0.325, 0.301, null], [0.34, 0.318, 0.295]],
  min_iv: 0.295, max_iv: 0.34,
};

beforeEach(() => {
  ivSurface.mockReset();
});

afterEach(cleanup);

describe("IvSurfacePanel", () => {
  it("shows the same grid as a table, with the IV values formatted", async () => {
    ivSurface.mockResolvedValue(surface);
    render(<IvSurfacePanel ticker="SPY" />);

    expect(ivSurface).toHaveBeenCalledWith("SPY", false);
    fireEvent.click(await screen.findByText("Show as table"));

    // The surface's own fallback: expiries down the side, strikes across the top. The smile
    // table below reads the same numbers the other way round, so scope to this one.
    const grid = within(screen.getByText("7d").closest("table") as HTMLElement);
    expect(grid.getByText("32.5%")).toBeDefined();
    expect(grid.getByText("29.5%")).toBeDefined();
    expect(grid.getByText("475")).toBeDefined();
    expect(grid.getAllByText("—").length).toBe(1); // the one strike with no quote
  });

  it("tells you to check OpenD when the market data is unavailable", async () => {
    ivSurface.mockRejectedValue(new ApiError("market data unavailable: no connection", 502));
    render(<IvSurfacePanel ticker="SPY" />);

    expect(await screen.findByText("market data unavailable: no connection")).toBeDefined();
    expect(screen.getByText("Check that OpenD is running, then refresh.")).toBeDefined();
  });
});