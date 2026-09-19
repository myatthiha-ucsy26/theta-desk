import { describe, expect, it } from "vitest";
import type { Decision, EdgeCell, JournalRow, Settings } from "./api";
import {
  changedSettings, formatMoney, modesAgreeing, parseDte, realizedIvPct, studyDtes, formatPct, formatStrike, GATES, gateStates, outcome, riskMeter, sortScanRows, spreadLabel,
  wouldPass,
} from "./views";

function decision(stage: Decision["stage"], over: Partial<Decision> = {}): Decision {
  return {
    ticker: "META", dte: 14, modes: ["ivrich"], stage, passed: stage === "alert",
    direction: "SELL_PUT", reason: "r", signal: null, edge: [], alert_key: null,
    ai_verdict: null, ai_reason: null, ...over,
  };
}

describe("gateStates", () => {
  it("lists the six gates in pipeline order with plain-language labels", () => {
    expect(GATES.map((g) => g.stage)).toEqual(["signal", "tradeable", "edge", "risk", "ai", "dedupe"]);
    expect(GATES.map((g) => g.label)).toEqual(["Signal", "Spread fits", "Backtest edge", "Risk limits", "AI review", "Not a repeat"]);
  });

  it("marks gates before the stop as passed, the stop as stopped, and the rest as not reached", () => {
    expect(gateStates(decision("edge", { ai_verdict: null }))).toEqual(
      ["passed", "passed", "stopped", "not-reached", "not-reached", "not-reached"]);
  });

  it("marks an error stop distinctly from a rule rejection", () => {
    expect(gateStates(decision("signal", { reason: "error: no ATM IV available" }))[0]).toBe("error");
  });

  it("passes every gate for an alert", () => {
    expect(gateStates(decision("alert", { ai_verdict: "CONFIRM" }))).toEqual(Array(6).fill("passed"));
  });

  it("shows the AI gate as skipped when it was switched off", () => {
    expect(gateStates(decision("alert", { ai_verdict: null }))[4]).toBe("skipped");
    expect(gateStates(decision("dedupe", { ai_verdict: null }))[4]).toBe("skipped");
  });

  it("shows any gate switched off in settings as skipped", () => {
    expect(gateStates(decision("alert", { ai_verdict: "CONFIRM", skipped: ["edge", "risk", "dedupe"] }))).toEqual(
      ["passed", "passed", "skipped", "skipped", "passed", "skipped"]);
  });
});

describe("outcome", () => {
  it("classifies decisions", () => {
    expect(outcome(decision("alert"))).toBe("alert");
    expect(outcome(decision("risk"))).toBe("near-miss");
    expect(outcome(decision("ai"))).toBe("near-miss");
    expect(outcome(decision("dedupe"))).toBe("near-miss");
    expect(outcome(decision("edge"))).toBe("rejected");
    expect(outcome(decision("signal", { reason: "error: OpenD down" }))).toBe("error");
  });
});

describe("sortScanRows", () => {
  const row = (ticker: string, stage: Decision["stage"], dte = 14, reason = "r"): JournalRow =>
    ({ id: 1, ts: "2026-09-16T14:00:00+00:00", decision: decision(stage, { ticker, dte, reason }) });

  it("puts alerts first, then near misses, then rejections, then errors, each by ticker and DTE", () => {
    const rows = [row("SPY", "signal"), row("AAPL", "signal", 14, "error: x"), row("QQQ", "alert"),
                  row("AMD", "risk"), row("META", "edge"), row("AMD", "alert", 7)];
    expect(sortScanRows(rows).map((r) => `${r.decision.ticker}/${r.decision.dte}`)).toEqual(
      ["AMD/7", "QQQ/14", "AMD/14", "META/14", "SPY/14", "AAPL/14"]);
  });
});

describe("formatting", () => {
  it("formats signed money with a true minus sign", () => {
    expect(formatMoney(125)).toBe("+$125");
    expect(formatMoney(-400.5)).toBe("−$401");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(1234.4)).toBe("+$1,234");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats unsigned money when asked", () => {
    expect(formatMoney(750, { signed: false })).toBe("$750");
  });

  it("formats percentages", () => {
    expect(formatPct(7.6923)).toBe("7.7%");
    expect(formatPct(-1.25)).toBe("−1.3%");
    expect(formatPct(null)).toBe("—");
  });

  it("keeps a strike's cents, which rounding would spend on a contract that isn't quoted", () => {
    expect(formatStrike(315)).toBe("$315");
    expect(formatStrike(731.5)).toBe("$731.50");
    expect(formatStrike(1234.5)).toBe("$1,234.50");
    expect(formatStrike(null)).toBe("—");
  });

  it("names spreads in plain language", () => {
    expect(spreadLabel("SELL_PUT")).toBe("Bull put");
    expect(spreadLabel("SELL_CALL")).toBe("Bear call");
    expect(spreadLabel("NO_TRADE")).toBe("No trade");
    expect(spreadLabel(null)).toBe("No trade");
  });
});

describe("riskMeter", () => {
  it("reports the share of the cap in use", () => {
    expect(riskMeter(750, 2500)).toEqual({ pct: 30, over: false });
  });

  it("caps the bar at 100 but flags going over", () => {
    expect(riskMeter(3000, 2500)).toEqual({ pct: 100, over: true });
  });

  it("handles a zero cap", () => {
    expect(riskMeter(0, 0)).toEqual({ pct: 0, over: false });
  });
});

describe("wouldPass", () => {
  const cell = (n: number, expectancy: number): EdgeCell => ({
    mode: "ivrich", dte: 7, bucket: "high", n, expectancy,
    win_rate: null, validated: true, passes: false,
  });

  it("passes a setup with enough trades and positive expectancy", () => {
    expect(wouldPass(cell(120, 0.5), 100, 0)).toBe(true);
  });

  it("needs at least the minimum trade count", () => {
    expect(wouldPass(cell(24, 42.5), 100, 0)).toBe(false);
    expect(wouldPass(cell(100, 42.5), 100, 0)).toBe(true);
  });

  it("needs expectancy above the minimum, not equal to it", () => {
    expect(wouldPass(cell(120, 0), 100, 0)).toBe(false);
    expect(wouldPass(cell(120, 0.01), 100, 0)).toBe(true);
    expect(wouldPass(cell(120, 5), 100, 5)).toBe(false);
  });
});

describe("changedSettings", () => {
  const saved = { interval_min: 15, watchlist: ["SPY", "QQQ"], ai_enabled: true } as unknown as Settings;

  it("returns only keys whose values differ, comparing lists by content", () => {
    const draft = { ...saved, interval_min: 30, watchlist: ["SPY", "QQQ"] } as Settings;
    expect(changedSettings(saved, draft)).toEqual({ interval_min: 30 });
  });

  it("detects a changed list", () => {
    const draft = { ...saved, watchlist: ["SPY"] } as Settings;
    expect(changedSettings(saved, draft)).toEqual({ watchlist: ["SPY"] });
  });

  it("returns an empty object when nothing changed", () => {
    expect(changedSettings(saved, { ...saved })).toEqual({});
  });
});

describe("modesAgreeing", () => {
  const verdicts = {
    ivrich: { direction: "SELL_PUT" as const, reason: "" },
    meanrev: { direction: "SELL_PUT" as const, reason: "" },
    trend: { direction: "NO_TRADE" as const, reason: "" },
  };

  it("counts checked modes on the signal's side", () => {
    expect(modesAgreeing({ modes: ["ivrich", "meanrev", "trend"], direction: "SELL_PUT", verdicts })).toBe("2 of 3 modes agree");
  });

  it("is null when there is no trade", () => {
    expect(modesAgreeing({ modes: ["trend"], direction: "NO_TRADE", verdicts })).toBeNull();
  });
});

describe("studyDtes", () => {
  it("offers 7 and 14, every saved expiry and the one in the link, in order", () => {
    expect(studyDtes([2, 7, 14], 7)).toEqual([2, 7, 14]);
    expect(studyDtes(null, 30)).toEqual([7, 14, 30]);
    expect(studyDtes([21], 7)).toEqual([7, 14, 21]);
  });
});

describe("parseDte", () => {
  it("reads a whole number of days from 1 to 365, else 7", () => {
    expect(parseDte("2")).toBe(2);
    expect(parseDte("14")).toBe(14);
    expect(parseDte(undefined)).toBe(7);
    expect(parseDte("0")).toBe(7);
    expect(parseDte("400")).toBe(7);
    expect(parseDte("2.5")).toBe(7);
  });
});

describe("realizedIvPct", () => {
  it("divides the ratio back out, so realised vol reads in the same units as IV", () => {
    // IV 28% at a ratio of 1.4 means realised was 20%.
    expect(realizedIvPct(28, 1.4)).toBeCloseTo(20);
  });

  it("has nothing to show without a usable ratio", () => {
    expect(realizedIvPct(28, null)).toBeNull();
    expect(realizedIvPct(28, undefined)).toBeNull();
    expect(realizedIvPct(28, 0)).toBeNull();
  });
});
