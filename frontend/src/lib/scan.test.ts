import { describe, it, expect } from "vitest";
import type { Decision, JournalRow, Settings, Signal, Stage } from "./api";
import { asStage, confidenceText, cycleSummary, expiryChip, filterByStage, filterScanRows, gateCells, gateStateWords, outcomeBadge, rowStatus, scanFilters, strategyLabel, tradeFacts, whyParts, whyText } from "./scan";

let nextId = 1;

function dec(ticker: string, stage: Stage, reason: string, over: Partial<Decision> = {}): Decision {
  return {
    ticker, dte: 14, modes: ["ivrich"], stage, passed: stage === "alert",
    direction: "SELL_PUT", reason, signal: null, edge: [],
    alert_key: null, ai_verdict: null, ai_reason: null, ...over,
  };
}

function row(decision: Decision): JournalRow {
  return { id: nextId++, ts: "2026-09-16T22:15:00+00:00", decision };
}

const qqqSignal: Signal = {
  ticker: "QQQ", spot: 470, expiration: "2026-09-30", dte: 14, modes: ["ivrich"],
  direction: "SELL_PUT", iv_pct: 0.3, iv_rank: 40,
  verdicts: {
    ivrich: { direction: "SELL_PUT", reason: "IV is rich" },
    meanrev: { direction: "NO_TRADE", reason: "no stretch" },
    trend: { direction: "NO_TRADE", reason: "no trend" },
  },
  spread: { side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388 },
};

const alert = row(dec("QQQ", "alert", "edge ok", { alert_sent: true, signal: qqqSignal }));
const nearMiss = row(dec("AMD", "risk", "at the position cap"));
const rejected = row(dec("META", "edge", "ivrich/14d/IV-mid: expectancy 0.0"));
const error = row(dec("AAPL", "signal", "error: no ATM IV available"));

describe("scanFilters", () => {
  it("counts each outcome, with All as the total", () => {
    expect(scanFilters([alert, nearMiss, rejected, error])).toEqual([
      { key: "all", label: "All", count: 4 },
      { key: "alert", label: "Alerts", count: 1 },
      { key: "near-miss", label: "Near misses", count: 1 },
      { key: "error", label: "Errors", count: 1 },
    ]);
  });

  it("shows zero counts for an empty board", () => {
    expect(scanFilters([]).map((f) => f.count)).toEqual([0, 0, 0, 0]);
  });
});

describe("filterScanRows", () => {
  const rows = [alert, nearMiss, rejected, error];

  it("keeps every row under all, including rejections", () => {
    expect(filterScanRows(rows, "all")).toEqual(rows);
  });

  it("keeps only the matching outcome", () => {
    expect(filterScanRows(rows, "error")).toEqual([error]);
    expect(filterScanRows(rows, "alert")).toEqual([alert]);
    expect(filterScanRows(rows, "near-miss")).toEqual([nearMiss]);
  });
});

describe("asStage", () => {
  it("takes a stage the engine runs", () => {
    expect(asStage("edge")).toBe("edge");
    expect(asStage("alert")).toBe("alert");
  });

  it("treats anything else as no filter rather than as an empty board", () => {
    // The stage arrives off a URL, so a stale or hand-typed gate name has to fall back to the whole
    // board. Reading an unknown name as a stage would hide every row and look like a quiet desk.
    expect(asStage("nowhere")).toBeNull();
    expect(asStage("")).toBeNull();
    expect(asStage(undefined)).toBeNull();
  });
});

describe("filterByStage", () => {
  const rows = [alert, nearMiss, rejected, error];

  it("keeps only the rows that stopped at that gate", () => {
    expect(filterByStage(rows, "edge")).toEqual([rejected]);
    expect(filterByStage(rows, "signal")).toEqual([error]);
  });

  it("keeps every row when no gate is named", () => {
    expect(filterByStage(rows, null)).toEqual(rows);
  });

  it("gives the sent alerts for the alert stage, not the rows turned back before it", () => {
    expect(filterByStage(rows, "alert")).toEqual([alert]);
  });
});

describe("gateStateWords", () => {
  it("names every state in words a person reads", () => {
    expect(gateStateWords("passed")).toBe("passed");
    expect(gateStateWords("stopped")).toBe("stopped");
    expect(gateStateWords("error")).toBe("error");
    expect(gateStateWords("not-reached")).toBe("not reached");
    expect(gateStateWords("skipped")).toBe("skipped");
  });
});

describe("outcomeBadge", () => {
  it("is good Alert sent for a delivered alert", () => {
    expect(outcomeBadge(alert.decision)).toEqual({ tone: "good", label: "Alert sent" });
  });

  it("is warn when the alert did not go out", () => {
    expect(outcomeBadge({ ...alert.decision, alert_sent: false }))
      .toEqual({ tone: "warn", label: "Passed, alert not delivered" });
  });

  it("is warn Near miss for a risk, ai or dedupe stop", () => {
    expect(outcomeBadge(nearMiss.decision)).toEqual({ tone: "warn", label: "Near miss" });
  });

  it("is neutral Rejected for an earlier stop", () => {
    expect(outcomeBadge(rejected.decision)).toEqual({ tone: "neutral", label: "Rejected" });
  });

  it("is critical Error for a failed gate", () => {
    expect(outcomeBadge(error.decision)).toEqual({ tone: "critical", label: "Error" });
  });
});

describe("whyText", () => {
  it("describes the spread for an alert, with the credit in cents", () => {
    expect(whyText(alert.decision)).toBe("Bull put 470/465, credit $1.12");
  });

  it("uses the decision reason for anything else", () => {
    expect(whyText(error.decision)).toBe("error: no ATM IV available");
    expect(whyText(rejected.decision)).toBe("ivrich/14d/IV-mid: expectancy 0.0");
  });
});

describe("whyParts", () => {
  it("splits the credit out of an alert, leaving the spread as the note", () => {
    expect(whyParts(alert.decision)).toEqual({ value: "$1.12", note: "Bull put 470/465" });
  });

  it("lifts IV/RV out of the reason so it reads as a column", () => {
    const d = dec("GOOGL", "signal", "ivrich: IV rich (IV/RV=1.28) but no mean-rev signal", {
      direction: "NO_TRADE",
      signal: { ...qqqSignal, direction: "NO_TRADE", spread: null, iv_rv: 1.28 },
    });
    expect(whyParts(d)).toEqual({
      value: "IV/RV 1.28",
      note: "IV rich but no mean-rev signal",
    });
  });

  it("reads the value from the typed signal, even when the reason spells it differently", () => {
    const d = dec("AMZN", "signal", "ivrich: IV not rich (IV/RV=9.99)", {
      direction: "NO_TRADE",
      signal: { ...qqqSignal, direction: "NO_TRADE", spread: null, iv_rv: 1.11 },
    });
    expect(whyParts(d)).toEqual({ value: "IV/RV 1.11", note: "IV not rich" });
  });

  it("has no value to show when the decision carries no signal", () => {
    expect(whyParts(error.decision)).toEqual({
      value: null,
      note: "no ATM IV available",
    });
    expect(whyParts(nearMiss.decision)).toEqual({
      value: null,
      note: "at the position cap",
    });
  });

  it("keeps a reason whose own prefix is not a bare mode name", () => {
    expect(whyParts(rejected.decision)).toEqual({
      value: null,
      note: "ivrich/14d/IV-mid: expectancy 0.0",
    });
  });
});
describe("confidenceText", () => {
  it("shows modes agreeing and the backtest win rate", () => {
    const d = dec("QQQ", "alert", "ok", { confidence: { agree: 2, of: 3, win_rate: 0.78, n: 611 } });
    expect(confidenceText(d)).toBe("2/3 modes · 78% win (n=611)");
  });

  it("shows only agreement before the edge gate has run", () => {
    const d = dec("QQQ", "tradeable", "no spread", { confidence: { agree: 1, of: 2, win_rate: null, n: null } });
    expect(confidenceText(d)).toBe("1/2 modes");
  });

  it("is empty with no signal or on older journal rows", () => {
    expect(confidenceText(dec("QQQ", "signal", "r", { confidence: { agree: 0, of: 3, win_rate: null, n: null } }))).toBeNull();
    expect(confidenceText(dec("QQQ", "signal", "r"))).toBeNull();
  });
});

// A row that cleared every gate, carrying every number the page can show.
const full = dec("NVDA", "alert", "edge ok", {
  modes: ["ivrich", "trend"],
  confidence: { agree: 2, of: 3, win_rate: 0.78, n: 611 },
  edge: ["ivrich/14d/IV-mid: expectancy $+12.3/trade over 240 trades"],
  ai_verdict: "CONFIRM",
  ai_reason: "solid",
  alert_key: "NVDA-put-2026-09-30",
  alert_sent: true,
  signal: {
    ...qqqSignal,
    ticker: "NVDA",
    modes: ["ivrich", "trend"],
    direction: "SELL_PUT",
    verdicts: {
      ivrich: { direction: "SELL_PUT", reason: "IV is rich" },
      meanrev: { direction: "NO_TRADE", reason: "no stretch" },
      trend: { direction: "SELL_PUT", reason: "uptrend" },
    },
    spread: { side: "put", short: 135, long: 130, width: 5, credit: 1.15, max_loss: 385, pop_pct: 68.2, short_delta: 0.28 },
  },
});

describe("gateCells", () => {
  it("names the six gates in order, using the engine's own codes", () => {
    expect(gateCells(full).map((c) => `${c.index}:${c.code}`)).toEqual([
      "1:SIGNAL", "2:TRADEABLE", "3:EDGE", "4:RISK", "5:AI", "6:DEDUPE",
    ]);
  });

  it("reads each gate's number off the typed fields", () => {
    expect(gateCells(full).map((c) => c.detail)).toEqual([
      "2/3 modes",
      "$1.15 cr · 5w",
      "$+12.3/trade",
      "$385",
      "confirmed",
      "cleared",
    ]);
  });

  it("leaves the stopping gate's detail empty, so the reason below the row carries it", () => {
    // META stopped at the edge gate: the reason is the rejection, not a cell reading.
    const cells = gateCells(rejected.decision);
    expect(cells[2].state).toBe("stopped");
    expect(cells[2].detail).toBeNull();
    expect(cells.slice(3).every((c) => c.state === "not-reached" && c.detail === null)).toBe(true);
  });

  it("has nothing to show for a row that never reached a gate", () => {
    expect(gateCells(error.decision).map((c) => c.detail)).toEqual([null, null, null, null, null, null]);
  });
});

describe("tradeFacts", () => {
  it("reads the four numbers the trade is priced on", () => {
    expect(tradeFacts(full)).toEqual({
      strikes: "135P / 130P",
      delta: "0.28",
      credit: "$1.15",
      maxLoss: "$385",
      pop: "68.2%",
    });
  });

  it("is empty for a row that was never priced", () => {
    expect(tradeFacts(error.decision)).toEqual({
      strikes: null, delta: null, credit: null, maxLoss: null, pop: null,
    });
  });

  it("leaves out a number the spread does not carry rather than printing zero", () => {
    // The fixture spread has no delta and no POP.
    expect(tradeFacts(alert.decision)).toEqual({
      strikes: "470P / 465P", delta: null, credit: "$1.12", maxLoss: "$388", pop: null,
    });
  });
});

describe("strategyLabel", () => {
  it("names the modes that fired on the side the row took", () => {
    expect(strategyLabel(full)).toBe("IV-rich + Trend bull put");
  });

  it("falls back to the checked modes when no verdict agrees", () => {
    expect(strategyLabel(alert.decision)).toBe("IV-rich bull put");
  });

  it("has no strategy on a row with no direction", () => {
    expect(strategyLabel(nearMiss.decision));
    expect(strategyLabel(dec("QQQ", "signal", "r", { direction: "NO_TRADE" }))).toBeNull();
  });
});

describe("cycleSummary", () => {
  const settings = { watchlist: ["QQQ", "GOOGL", "LULU"], dtes: [7, 14] } as Settings;

  it("counts the board, and reads the watchlist off Settings", () => {
    expect(cycleSummary([alert, nearMiss, rejected], settings)).toEqual({
      logged: 3,
      watchlist: 3,
      dtes: [7, 14],
      cleared: 1,
    });
  });

  it("reports nothing watched rather than failing when Settings has not landed", () => {
    expect(cycleSummary([alert], null)).toEqual({ logged: 1, watchlist: 0, dtes: [], cleared: 1 });
  });
});

describe("expiryChip", () => {
  it("names the weekday once the row carries an expiry", () => {
    // 2026-09-30 is a Wednesday.
    expect(expiryChip(alert.decision)).toBe("14 DTE (WED)");
  });

  it("shows only the day count before a signal has been run", () => {
    expect(expiryChip(nearMiss.decision)).toBe("14 DTE");
  });
});

describe("rowStatus", () => {
  it("names the gate a row stopped at", () => {
    expect(rowStatus(rejected.decision)).toEqual({ tone: "neutral", label: "Stopped at gate 3 (EDGE)" });
  });

  it("says errored rather than stopped when the gate threw", () => {
    expect(rowStatus(error.decision)).toEqual({ tone: "critical", label: "Errored at gate 1 (SIGNAL)" });
  });

  it("keeps the delivered-alert wording for a row that cleared every gate", () => {
    expect(rowStatus(alert.decision)).toEqual({ tone: "good", label: "Alert sent" });
    expect(rowStatus({ ...alert.decision, alert_sent: false }))
      .toEqual({ tone: "warn", label: "Passed, alert not delivered" });
  });
});
