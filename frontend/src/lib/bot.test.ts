import { describe, expect, it } from "vitest";
import type { BotStatus, LiveTrade } from "./api";
import { botBadge, exitLevels, slotProgress } from "./bot";

const base: BotStatus = {
  mode: "auto", paused: false, pause_reason: "",
  monitor: { state: "watching", last_ok: "2026-09-16T15:00:00+00:00", last_error: null },
  net_pnl: 120, slots: 1, next_slot_at: 500, active: [], closed: [], marks: {}, events: [],
};

const trade = { id: "t", credit: 0.6 } as LiveTrade;

describe("botBadge", () => {
  it("says off outside auto mode", () => {
    expect(botBadge({ ...base, mode: "manual" })).toEqual({ tone: "neutral", label: "Bot off" });
  });
  it("puts a pause first, with its reason", () => {
    expect(botBadge({ ...base, paused: true, pause_reason: "stopped by you" })).toEqual({
      tone: "critical", label: "Bot paused: stopped by you",
    });
  });
  it("flags a monitor error", () => {
    const b = { ...base, monitor: { ...base.monitor, state: "error", last_error: "OpenD down" } };
    expect(botBadge(b)).toEqual({ tone: "critical", label: "Bot monitor error: OpenD down" });
  });
  it("shows trades in progress, else watching", () => {
    expect(botBadge({ ...base, active: [trade] })).toEqual({ tone: "good", label: "Bot in trade (1)" });
    expect(botBadge(base)).toEqual({ tone: "good", label: "Bot watching" });
    expect(botBadge(null)).toEqual({ tone: "neutral", label: "Bot —" });
  });
});

describe("slotProgress", () => {
  it("shows net profit, slots and the next unlock", () => {
    expect(slotProgress(base)).toBe("Net bot profit +$120 · 1 slot · next slot at $500");
    expect(slotProgress({ ...base, net_pnl: 610, slots: 2, next_slot_at: 1000 })).toBe(
      "Net bot profit +$610 · 2 slots · next slot at $1,000",
    );
  });
});

describe("exitLevels", () => {
  it("prices TP and SL from the fill credit", () => {
    expect(exitLevels(trade, 50, 2)).toEqual({ tp: 0.3, sl: 1.8 });
    expect(exitLevels({ ...trade, credit: null }, 50, 2)).toBeNull();
  });
});
