import { describe, expect, it } from "vitest";
import { demoBook } from "./book";

const NOW = new Date("2026-09-24T15:00:00Z");

describe("demoBook", () => {
  it("is the same book every time for the same moment", () => {
    expect(demoBook(NOW)).toEqual(demoBook(NOW));
  });

  it("wins most trades, loses some, and is net profitable", () => {
    const { closed } = demoBook(NOW);
    const wins = closed.filter((t) => t.pnl > 0).length;
    const rate = wins / closed.length;
    expect(closed.length).toBeGreaterThanOrEqual(40);
    expect(rate).toBeGreaterThan(0.7);
    expect(rate).toBeLessThan(0.85);
    expect(closed.some((t) => t.pnl < 0)).toBe(true);
    expect(closed.reduce((s, t) => s + t.pnl, 0)).toBeGreaterThan(0);
  });

  it("has a real drawdown in it, not a straight line up", () => {
    let cum = 0, peak = 0, worst = 0;
    for (const t of demoBook(NOW).closed) {
      cum += t.pnl;
      peak = Math.max(peak, cum);
      worst = Math.min(worst, cum - peak);
    }
    expect(worst).toBeLessThan(-150);
  });

  it("keeps closed trades in the past and open ones unexpired", () => {
    const { closed, open } = demoBook(NOW);
    expect(closed.every((t) => new Date(t.closedAt) <= NOW)).toBe(true);
    expect(open).toHaveLength(4);
    expect(open.every((t) => new Date(t.expiry) > NOW && new Date(t.openedAt) < NOW)).toBe(true);
  });

  it("moves the open marks as time passes, so P&L ticks like a live book", () => {
    const later = new Date(NOW.getTime() + 60_000);
    const a = demoBook(NOW).open.map((t) => t.mark);
    const b = demoBook(later).open.map((t) => t.mark);
    expect(a).not.toEqual(b);
  });
});

describe("demoBook during a session", () => {
  const start = NOW.getTime();
  const at = (min: number) => demoBook(new Date(start + min * 60_000), NOW);

  it("closes a trade every so often while the demo is open, so realised P&L moves", () => {
    const before = at(0).closed;
    const later = at(10).closed;
    expect(later.length).toBeGreaterThan(before.length);
    const sum = (xs: { pnl: number }[]) => xs.reduce((s, t) => s + t.pnl, 0);
    expect(sum(later)).not.toBe(sum(before));
  });

  it("plays the same session to anyone watching the same minutes", () => {
    expect(at(7)).toEqual(at(7));
  });

  it("wins most of the session's trades and loses some, like the history before it", () => {
    const session = at(120).closed.slice(at(0).closed.length);
    const rate = session.filter((t) => t.pnl > 0).length / session.length;
    expect(session.length).toBeGreaterThan(100);
    expect(rate).toBeGreaterThan(0.65);
    expect(rate).toBeLessThan(0.92);
  });

  it("keeps every session close in the past", () => {
    const now = new Date(start + 10 * 60_000);
    expect(demoBook(now, NOW).closed.every((t) => new Date(t.closedAt) <= now)).toBe(true);
  });
});
