import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStreamEvent } from "../stream";
import { DemoEventSource } from "./stream";

afterEach(() => vi.useRealTimers());

function collect(url: string) {
  vi.useFakeTimers();
  const es = new DemoEventSource(url);
  const seen: { type: string; data: string }[] = [];
  for (const type of ["log", "result", "abort"]) {
    es.addEventListener(type, (ev) => seen.push({ type, data: String((ev as MessageEvent).data) }));
  }
  vi.runAllTimers();
  return seen;
}

describe("DemoEventSource", () => {
  it("streams log lines, then a signal the Study screen can read", () => {
    const seen = collect("/api/signal/stream?ticker=MSFT&dte=7&modes=ivrich");
    expect(seen.filter((e) => e.type === "log").length).toBeGreaterThan(2);
    const last = seen.at(-1)!;
    expect(last.type).toBe("result");
    const event = parseStreamEvent(last.type, last.data);
    expect(event.kind === "result" && (event.data as { ticker: string }).ticker).toBe("MSFT");
  });

  it("streams a backtest with its stats and trades", () => {
    const last = collect("/api/backtest/stream?ticker=SPY&dte=14&modes=ivrich").at(-1)!;
    const event = parseStreamEvent(last.type, last.data);
    const data = event.kind === "result" ? (event.data as { stats: { n: number }; trades: unknown[] }) : null;
    expect(data?.stats.n).toBe(data?.trades.length);
  });

  it("stops sending once closed", () => {
    vi.useFakeTimers();
    const es = new DemoEventSource("/api/signal/stream?ticker=SPY&dte=7&modes=ivrich");
    const seen: string[] = [];
    es.addEventListener("result", () => seen.push("result"));
    es.close();
    vi.runAllTimers();
    expect(seen).toEqual([]);
  });
});
