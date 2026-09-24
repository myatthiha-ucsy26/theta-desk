import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { DEMO_REFUSAL, demoRequest } from "./router";

afterEach(() => vi.restoreAllMocks());

const get = <T,>(path: string) => demoRequest(path) as Promise<T>;

describe("demoRequest", () => {
  it("never touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const path of [
      "/api/engine/status", "/api/scan/latest", "/api/journal?limit=40", "/api/settings",
      "/api/ai/providers", "/api/bot", "/api/bot/preflight", "/api/paper", "/api/account",
      "/api/learn?days=7", "/api/settings/defaults", "/api/signal?ticker=SPY&dte=7&modes=ivrich",
      "/api/iv-surface?ticker=SPY",
    ]) {
      await expect(demoRequest(path)).resolves.toBeDefined();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses every write, so a demo can never trade or change a setting", async () => {
    for (const path of [
      "/api/settings", "/api/scan/now", "/api/scan/clear", "/api/bot/stop", "/api/bot/resume",
      "/api/bot/close-all", "/api/settings/reset", "/api/paper/open", "/api/paper/close",
    ]) {
      const err = await demoRequest(path, { method: "POST", body: "{}" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe(DEMO_REFUSAL);
    }
  });

  it("still answers the read-only calculations a screen posts for", async () => {
    const grid = await demoRequest("/api/payoff", {
      method: "POST",
      body: JSON.stringify({ direction: "SELL_PUT", short_strike: 95, long_strike: 90, credit: 1.2, spot: 100, sigma: 0.3, days_left: 10 }),
    }) as { max_profit: number; max_loss: number; pnl: number[][] };
    expect(grid.max_profit).toBe(120);
    expect(grid.max_loss).toBe(-380);
    // Expiry row, far above the short strike: the whole credit is kept.
    expect(grid.pnl[grid.pnl.length - 1].at(-1)).toBe(120);
  });

  it("tells the same story everywhere: account, bot and header agree on the open book", async () => {
    const account = await get<{ open_count: number; account: string }>("/api/account");
    const bot = await get<{ active: unknown[] }>("/api/bot");
    const status = await get<{ account_mode: string }>("/api/engine/status");
    expect(account.account).toBe("live");
    expect(status.account_mode).toBe("live");
    expect(account.open_count).toBe(bot.active.length);
  });
});
