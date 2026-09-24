// Study's signal and backtest runs, played back in the demo: the same log-then-result events the
// server streams, on timers, with nothing opened to any server.
import type { SignalMode } from "../api";
import { demoBacktest, demoSignal } from "./router";

type Listener = (ev: Event) => void;

const STEP_MS = 280;

export class DemoEventSource {
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(url: string) {
    const [path, query = ""] = url.split("?");
    const q = new URLSearchParams(query);
    const ticker = (q.get("ticker") ?? "SPY").toUpperCase();
    const dte = Number(q.get("dte") ?? 7);
    const modes = (q.get("modes") ?? "ivrich").split(",") as SignalMode[];
    const backtest = path.endsWith("/backtest/stream");
    const logs: [string, string][] = backtest
      ? [["history", `${ticker}: 5 years of daily bars from the cache`], ["replay", `Replaying ${modes.join("+")} at ${dte} DTE`],
         ["price", "Pricing each spread with Black-Scholes off realised vol"], ["stats", "Adding up wins, losses and drawdown"]]
      : [["spot", `${ticker}: spot and the option chain`], ["indicators", "RSI, %B, ADX, EMA20/50"],
         ["iv", "IV against realised vol, and its rank"], ["modes", `Asking ${modes.join(", ")}`], ["spread", "Choosing strikes near 0.30 delta"]];
    logs.forEach(([step, msg], i) => this.later(i, "log", { step, msg }));
    this.later(logs.length, "result", { data: backtest ? demoBacktest(ticker, dte) : demoSignal(ticker, dte, modes) });
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private later(i: number, type: string, payload: unknown) {
    this.timers.push(setTimeout(() => {
      const ev = new MessageEvent(type, { data: JSON.stringify(payload) });
      (this.listeners.get(type) ?? []).forEach((fn) => fn(ev));
    }, (i + 1) * STEP_MS));
  }
}
