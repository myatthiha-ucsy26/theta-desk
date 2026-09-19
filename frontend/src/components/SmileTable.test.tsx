import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IvSurface, Spread } from "../lib/api";
import { SmileTable } from "./SmileTable";

const surface: IvSurface = {
  ticker: "SPY", spot: 471.25,
  expiries: ["2026-09-23", "2026-09-30", "2026-10-07"],
  dtes: [7, 14, 21],
  strikes: [460, 465, 470, 475],
  iv: [
    [0.38, 0.35, 0.31, 0.29],
    [0.36, 0.33, 0.3, 0.28],
    [0.35, 0.32, 0.295, 0.275],
  ],
  min_iv: 0.275, max_iv: 0.38,
};

const spread: Spread = {
  side: "put", short: 465, long: 460, width: 5, credit: 1.12, max_loss: 388, pop_pct: 68.2,
};

afterEach(cleanup);

const cell = (strike: string) => within(screen.getByText(strike).closest("tr") as HTMLElement);

/** One reading out of the footer, found by its label. */
const read = (label: string) => within(screen.getByText(label).parentElement as HTMLElement);

describe("SmileTable", () => {
  it("runs strikes down the side and expirations across the top", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    expect(screen.getByText("Strike")).toBeDefined();
    for (const d of ["7 DTE", "14 DTE", "21 DTE"]) expect(screen.getByText(d)).toBeDefined();
    for (const k of ["$460", "$465", "$470", "$475"]) expect(cell(k)).toBeDefined();
  });

  it("reads each row across the expiries", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    // $465 sits at 35.0% at 7 DTE and 33.0% at 14 DTE.
    expect(cell("$465").getByText("35.0%")).toBeDefined();
    expect(cell("$465").getByText("33.0%")).toBeDefined();
  });

  it("tags the long leg, the short leg and the money", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    expect(cell("$460").getByText("L")).toBeDefined();
    expect(cell("$465").getByText("S")).toBeDefined();
    expect(cell("$470").getByText("ATM")).toBeDefined();
  });

  it("leaves a strike that is none of the three untagged", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    expect(cell("$475").queryByText("ATM")).toBe(null);
    expect(cell("$475").queryByText("S")).toBe(null);
  });

  it("picks out the column of the expiry being studied", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    expect(screen.getByText("14 DTE").className).toContain("text-accent");
    expect(screen.getByText("7 DTE").className).not.toContain("text-accent");
  });

  it("reads the put wing against the call wing off the studied expiry", () => {
    // 14 DTE: the $460 put at 36.0% against the $475 call at 28.0%.
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    expect(read("Skew").getByText("+8.0%")).toBeDefined();
    expect(read("Skew").getByText("put wing rich")).toBeDefined();
  });

  it("calls the skew the other way when the calls are the expensive wing", () => {
    const callsRich: IvSurface = {
      ...surface,
      iv: [[0.29, 0.31, 0.34, 0.38], [0.28, 0.3, 0.33, 0.36], [0.275, 0.295, 0.32, 0.35]],
    };
    render(<SmileTable surface={callsRich} spread={spread} dte={14} />);
    // The $460 put at 28.0% against the $475 call at 36.0%.
    expect(read("Skew").getByText("−8.0%")).toBeDefined();
    expect(read("Skew").getByText("call wing rich")).toBeDefined();
  });

  it("names the term whose money carries the most premium, and what it reads", () => {
    render(<SmileTable surface={surface} spread={spread} dte={14} />);
    // The money's IV is 31.0% at 7 DTE, 30.0% at 14 and 29.5% at 21: the near end is richest.
    expect(read("Richest term").getByText("7D")).toBeDefined();
    expect(read("Richest term").getByText("31.0%")).toBeDefined();
  });

  it("has neither reading when the surface came back with nothing in it", () => {
    render(<SmileTable surface={{ ...surface, strikes: [], iv: [] }} dte={7} />);
    expect(read("Skew").getByText("—")).toBeDefined();
    expect(read("Richest term").getByText("—")).toBeDefined();
  });

  it("reads without a spread to tag, which is the case on a ticker with no signal", () => {
    render(<SmileTable surface={surface} dte={14} />);
    expect(cell("$465").queryByText("S")).toBe(null);
    expect(cell("$470").getByText("ATM")).toBeDefined();
  });

  it("shows an em dash where the surface has no quote for a strike", () => {
    const holed: IvSurface = { ...surface, iv: [[0.38, null, 0.31, 0.29]] };
    render(<SmileTable surface={holed} dte={7} />);
    expect(cell("$465").getByText("—")).toBeDefined();
  });
});