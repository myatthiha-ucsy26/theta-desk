import { describe, expect, it } from "vitest";
import type { Decision, JournalRow } from "./api";
import { funnel } from "./funnel";

const decision = (over: Partial<Decision> = {}): Decision => ({
  ticker: "META", dte: 7, modes: ["meanrev"], stage: "signal", passed: false,
  direction: null, reason: "IV not rich enough", signal: null, edge: [],
  alert_key: null, ai_verdict: null, ai_reason: null,
  ...over,
});

const rows = (...ds: Decision[]): JournalRow[] =>
  ds.map((d, i) => ({ id: i + 1, ts: "2026-09-18T03:59:00", decision: d }));

describe("funnel", () => {
  it("returns one entry per gate, in pipeline order", () => {
    const f = funnel([]);
    expect(f.map((g) => g.label)).toEqual([
      "Signal", "Spread fits", "Backtest edge", "Risk limits", "AI review", "Not a repeat",
    ]);
    expect(f.map((g) => g.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("counts a row only against the gates it actually reached", () => {
    const f = funnel(rows(decision({ stage: "tradeable" })));
    expect(f[0]).toMatchObject({ reached: 1, through: 1, stopped: 0 });
    expect(f[1]).toMatchObject({ reached: 1, through: 0, stopped: 1 });
    // Stopped at gate 2, so gates 3-6 were never reached.
    expect(f[2].reached).toBe(0);
    expect(f[2].rate).toBeNull();
  });

  it("reads the pass rate as throughput over what reached the gate", () => {
    const f = funnel(rows(
      decision({ stage: "alert" }),
      decision({ stage: "alert" }),
      decision({ stage: "tradeable" }),
      decision({ stage: "tradeable" }),
    ));
    expect(f[0].rate).toBe(100);
    expect(f[1]).toMatchObject({ reached: 4, through: 2, stopped: 2, rate: 50 });
  });

  it("counts an error at a gate separately from a stop", () => {
    const f = funnel(rows(decision({ stage: "signal", reason: "error: OpenD timeout" })));
    expect(f[0]).toMatchObject({ reached: 1, through: 0, stopped: 0, errored: 1 });
  });

  it("treats a skipped gate as through, and marks it off when it never runs", () => {
    const skipped = rows(
      decision({ stage: "alert", skipped: ["ai"] }),
      decision({ stage: "alert", skipped: ["ai"] }),
    );
    const f = funnel(skipped);
    expect(f[4]).toMatchObject({ reached: 2, through: 2, stopped: 0, rate: 100, off: true });
    expect(f[0].off).toBe(false);
  });

  it("does not call a gate off when only some rows skipped it", () => {
    const f = funnel(rows(
      decision({ stage: "alert", skipped: ["ai"] }),
      decision({ stage: "alert", ai_verdict: "CONFIRM" }),
    ));
    expect(f[4]).toMatchObject({ reached: 2, through: 2, off: false });
  });
});
