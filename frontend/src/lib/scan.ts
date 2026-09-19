// Scan board view logic: row filters, the gate segment's words, and the result badge. Pure.
import type { Decision, JournalRow, Settings, SignalMode, Stage } from "./api";
import type { Tone } from "../components/StatusBadge";
import { weekdayShort } from "./time";
import {
  GATES,
  GATE_CODES,
  formatMoney,
  formatPct,
  gateStates,
  outcome,
  spreadLabel,
  type GateState,
  type Outcome,
} from "./views";

export type FilterKey = "all" | Exclude<Outcome, "rejected">;

export interface ScanFilter { key: FilterKey; label: string; count: number }

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "alert", label: "Alerts" },
  { key: "near-miss", label: "Near misses" },
  { key: "error", label: "Errors" },
];

export function scanFilters(rows: JournalRow[]): ScanFilter[] {
  return FILTERS.map((f) => ({
    ...f,
    count: f.key === "all" ? rows.length : rows.filter((r) => outcome(r.decision) === f.key).length,
  }));
}

export function filterScanRows(rows: JournalRow[], key: FilterKey): JournalRow[] {
  return key === "all" ? rows : rows.filter((r) => outcome(r.decision) === key);
}

/** Every stage a scan can stop at, in the order the engine runs them. */
const STAGES: Stage[] = ["signal", "tradeable", "edge", "risk", "ai", "dedupe", "alert"];

/**
 * A stage off the URL, or null if it names nothing.
 *
 * The funnel's gate rows link into this board, so the stage arrives as a query parameter and has
 * to be treated as untrusted text: anything that isn't one of the engine's own stage names is no
 * filter at all rather than an empty board.
 */
export function asStage(value: string | undefined): Stage | null {
  return value !== undefined && (STAGES as string[]).includes(value) ? (value as Stage) : null;
}

/**
 * The rows that stopped at one gate — how many the funnel turned away there, and which ones.
 *
 * A row is at its own stage while it is stopped there; a row that cleared everything is at
 * "alert", so asking for "alert" returns the ones that were sent rather than the ones turned back.
 */
export function filterByStage(rows: JournalRow[], stage: Stage | null): JournalRow[] {
  return stage === null ? rows : rows.filter((r) => r.decision.stage === stage);
}

export interface CycleSummary {
  /** Tickers with a decision on the board — the board keeps the latest row for each. */
  logged: number;
  /** Tickers and expiries the engine is set up to look at, from Settings. */
  watchlist: number;
  dtes: number[];
  /** Rows that came through every gate. */
  cleared: number;
}

export function cycleSummary(rows: JournalRow[], settings: Settings | null): CycleSummary {
  return {
    logged: rows.length,
    watchlist: settings?.watchlist.length ?? 0,
    dtes: settings?.dtes ?? [],
    cleared: rows.filter((r) => outcome(r.decision) === "alert").length,
  };
}

const GATE_WORDS: Record<GateState, string> = {
  passed: "passed",
  stopped: "stopped",
  error: "error",
  "not-reached": "not reached",
  skipped: "skipped",
};

export function gateStateWords(state: GateState): string {
  return GATE_WORDS[state];
}

export function outcomeBadge(d: Decision): { tone: Tone; label: string } {
  switch (outcome(d)) {
    case "alert":
      return d.alert_sent === false
        ? { tone: "warn", label: "Passed, alert not delivered" }
        : { tone: "good", label: "Alert sent" };
    case "near-miss":
      return { tone: "warn", label: "Near miss" };
    case "error":
      return { tone: "critical", label: "Error" };
    default:
      return { tone: "neutral", label: "Rejected" };
  }
}

// The credit stays in cents: whole-dollar rounding would hide the number the trade is priced on.
export function whyText(d: Decision): string {
  const s = d.signal?.spread;
  if (outcome(d) === "alert" && s) {
    return `${spreadLabel(d.direction)} ${s.short}/${s.long}, credit $${s.credit.toFixed(2)}`;
  }
  return d.reason;
}

export interface WhyParts {
  /** The number the scan turned on, or null when this row has none. */
  value: string | null;
  /** What happened, in plain words, with the number taken out. */
  note: string;
}

// The engine writes the number into the reason as well, e.g. "IV rich (IV/RV=1.28) but no
// mean-rev signal". The value already arrives typed on the signal, so read it there and use
// the pattern only to drop the duplicate from the prose.
const IV_RV_INLINE = /\(IV\/RV=[\d.]+\)/;
const MODE_PREFIX = /^[a-z]+:\s*/;

export function whyParts(d: Decision): WhyParts {
  const s = d.signal?.spread;
  if (outcome(d) === "alert" && s) {
    return {
      value: `$${s.credit.toFixed(2)}`,
      note: `${spreadLabel(d.direction)} ${s.short}/${s.long}`,
    };
  }
  const rv = d.signal?.iv_rv;
  return {
    value: rv === null || rv === undefined ? null : `IV/RV ${rv.toFixed(2)}`,
    note: d.reason
      .replace(IV_RV_INLINE, "")
      .replace(MODE_PREFIX, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}
/** Modes agreeing, plus the backtest win rate once the edge gate has looked it up. */
export function confidenceText(d: Decision): string | null {
  const c = d.confidence;
  if (!c || c.agree === 0) return null;
  const modes = `${c.agree}/${c.of} modes`;
  return c.win_rate === null ? modes : `${modes} · ${Math.round(c.win_rate * 100)}% win (n=${c.n})`;
}

const MODE_WORD: Record<SignalMode, string> = {
  ivrich: "IV-rich",
  meanrev: "Mean-rev",
  trend: "Trend",
};

/** "IV-rich bull put" — the modes that actually fired on the side the row took. */
export function strategyLabel(d: Decision): string | null {
  if (!d.direction || d.direction === "NO_TRADE") return null;
  const fired = d.modes.filter((m) => d.signal?.verdicts[m]?.direction === d.direction);
  const word = (fired.length > 0 ? fired : d.modes).map((m) => MODE_WORD[m]).join(" + ");
  const side = spreadLabel(d.direction);
  return word ? `${word} ${side.toLowerCase()}` : side;
}

/** "14 DTE (FRI)" once the row carries an expiry; the day count alone before that. */
export function expiryChip(d: Decision): string {
  const day = weekdayShort(d.signal?.expiration);
  return day ? `${d.dte} DTE (${day})` : `${d.dte} DTE`;
}

export interface TradeFacts {
  /** "315P / 310P" — the two strikes, each tagged with its side. */
  strikes: string | null;
  delta: string | null;
  credit: string | null;
  maxLoss: string | null;
  pop: string | null;
}

/**
 * The four numbers the trade is priced on, read straight off the spread. Nulls where the row
 * never got a spread — a ticker that stopped at the signal gate was never priced.
 */
export function tradeFacts(d: Decision): TradeFacts {
  const s = d.signal?.spread;
  if (!s) return { strikes: null, delta: null, credit: null, maxLoss: null, pop: null };
  const letter = s.side === "put" ? "P" : "C";
  return {
    strikes: `${s.short}${letter} / ${s.long}${letter}`,
    delta: s.short_delta === undefined || s.short_delta === null ? null : s.short_delta.toFixed(2),
    credit: `$${s.credit.toFixed(2)}`,
    maxLoss: formatMoney(s.max_loss, { signed: false }),
    pop: s.pop_pct === undefined || s.pop_pct === null ? null : formatPct(s.pop_pct),
  };
}

export interface GateCell {
  index: number;
  label: string;
  /** The engine's short name for the gate: SIGNAL, TRADEABLE, EDGE, RISK, AI, DEDUPE. */
  code: string;
  state: GateState;
  /** The number that decided this gate, when the row carries one. Never a guess. */
  detail: string | null;
}

// cs_edge writes "ivrich/14d/IV-mid: expectancy $+12.3/trade over 240 trades"; the figure is the
// part worth a cell, and reading it out of the prose beats re-deriving it.
const EXPECTANCY = /expectancy\s+(\$[+-][\d.]+\/trade)/;

const AI_WORD: Record<string, string> = { CONFIRM: "confirmed", CAUTION: "caution", AVOID: "avoid" };

/** One cell per gate: how far the row got there, and what that gate read. */
export function gateCells(d: Decision): GateCell[] {
  const states = gateStates(d);
  const s = d.signal?.spread;
  const c = d.confidence;

  return GATES.map((gate, i) => {
    const state = states[i];
    const reached = state === "passed" || state === "skipped";
    let detail: string | null = null;
    if (reached) {
      switch (gate.stage) {
        case "signal":
          detail = c && c.agree > 0 ? `${c.agree}/${c.of} modes` : null;
          break;
        case "tradeable":
          detail = s ? `$${s.credit.toFixed(2)} cr · ${s.width}w` : null;
          break;
        case "edge":
          detail = d.edge.length > 0 ? (d.edge[0].match(EXPECTANCY)?.[1] ?? null) : null;
          break;
        case "risk":
          detail = s ? formatMoney(s.max_loss, { signed: false }) : null;
          break;
        case "ai":
          detail = d.ai_verdict ? (AI_WORD[d.ai_verdict] ?? d.ai_verdict.toLowerCase()) : null;
          break;
        case "dedupe":
          detail = d.alert_key ? "cleared" : null;
          break;
      }
    }
    return { index: i + 1, label: gate.label, code: GATE_CODES[gate.label] ?? gate.label, state, detail };
  });
}

/** Where the row ended, named by gate: "Stopped at gate 3 (EDGE)". */
export function rowStatus(d: Decision): { tone: Tone; label: string } {
  const badge = outcomeBadge(d);
  const stop = gateCells(d).find((c) => c.state === "stopped" || c.state === "error");
  if (!stop) return badge;
  return {
    tone: badge.tone,
    label: `${stop.state === "error" ? "Errored" : "Stopped"} at gate ${stop.index} (${stop.code})`,
  };
}
