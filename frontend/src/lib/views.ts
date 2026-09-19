// View logic shared by the screens. Pure and tested; components stay presentational.
import type { Decision, Direction, EdgeCell, JournalRow, Settings, Signal, Stage } from "./api";

export const GATES: { stage: Exclude<Stage, "alert">; label: string }[] = [
  { stage: "signal", label: "Signal" },
  { stage: "tradeable", label: "Spread fits" },
  { stage: "edge", label: "Backtest edge" },
  { stage: "risk", label: "Risk limits" },
  { stage: "ai", label: "AI review" },
  { stage: "dedupe", label: "Not a repeat" },
];

/** The engine's own names for the gates, as the checklist prints them. */
export const GATE_CODES: Record<string, string> = {
  Signal: "SIGNAL",
  "Spread fits": "TRADEABLE",
  "Backtest edge": "EDGE",
  "Risk limits": "RISK",
  "AI review": "AI",
  "Not a repeat": "DEDUPE",
};

export type GateState = "passed" | "stopped" | "error" | "not-reached" | "skipped";
export type Outcome = "alert" | "near-miss" | "rejected" | "error";

const ORDER: Stage[] = ["signal", "tradeable", "edge", "risk", "ai", "dedupe", "alert"];
const AI_INDEX = ORDER.indexOf("ai");

const isError = (d: Decision) => d.reason.startsWith("error:");

export function gateStates(d: Decision): GateState[] {
  const stop = ORDER.indexOf(d.stage);
  return GATES.map((_, i) => {
    if (i < stop && d.skipped?.includes(ORDER[i])) return "skipped";
    if (i === AI_INDEX && stop > AI_INDEX && d.ai_verdict === null) return "skipped";
    if (i < stop) return "passed";
    if (i === stop) return isError(d) ? "error" : "stopped";
    return "not-reached";
  });
}

export function outcome(d: Decision): Outcome {
  if (d.stage === "alert") return "alert";
  if (isError(d)) return "error";
  if (d.stage === "risk" || d.stage === "ai" || d.stage === "dedupe") return "near-miss";
  return "rejected";
}

const RANK: Record<Outcome, number> = { alert: 0, "near-miss": 1, rejected: 2, error: 3 };

export function sortScanRows(rows: JournalRow[]): JournalRow[] {
  return [...rows].sort((a, b) =>
    RANK[outcome(a.decision)] - RANK[outcome(b.decision)]
    || a.decision.ticker.localeCompare(b.decision.ticker)
    || a.decision.dte - b.decision.dte);
}

const MINUS = "−";

export function formatMoney(v: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const signed = opts.signed ?? true;
  const whole = Math.round(Math.abs(v)).toLocaleString("en-US");
  if (Math.round(v) === 0) return "$0";
  if (v < 0) return `${MINUS}$${whole}`;
  return signed ? `+$${whole}` : `$${whole}`;
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toFixed(1);
  return v < 0 ? `${MINUS}${s}%` : `${s}%`;
}

/** Delta and gamma are share counts, not dollars: a plain signed number carries no currency mark. */
export function formatShares(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const r = Math.round(v);
  if (r === 0) return "0";
  return r < 0 ? `${MINUS}${Math.abs(r).toLocaleString("en-US")}` : `+${r.toLocaleString("en-US")}`;
}

/**
 * Theta and vega are dollars, but small ones: a spread here earns a couple of dollars a day and
 * sheds a couple per vol point, so rounding them to whole dollars would erase the reading.
 */
export function formatPreciseMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) < 0.005) return "$0.00";
  return `${v < 0 ? MINUS : "+"}$${Math.abs(v).toFixed(2)}`;
}

/**
 * A strike, which unlike a rounded dollar figure keeps its cents. Half-point strikes are
 * real (SPY 731.5); rounding one to 732 would name a contract that is not the one quoted.
 */
export function formatStrike(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const dp = Number.isInteger(v) ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: 2 })}`;
}

export function spreadLabel(direction: Direction | null): string {
  if (direction === "SELL_PUT") return "Bull put";
  if (direction === "SELL_CALL") return "Bear call";
  return "No trade";
}

const DTE_MIN = 1;
const DTE_MAX = 365;

/** Days to expiry from a link: a whole number from 1 to 365, else the 7-day default. */
export function parseDte(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= DTE_MIN && n <= DTE_MAX ? n : 7;
}

/** Study's expiry choices: 7 and 14, every expiry saved in Settings, and the current one. */
export function studyDtes(saved: number[] | null, current: number): number[] {
  return [...new Set([7, 14, ...(saved ?? []), current])].sort((a, b) => a - b);
}

/** How many checked modes fired on the signal's side. Any one firing is enough to signal. */
export function modesAgreeing(signal: Pick<Signal, "modes" | "direction" | "verdicts">): string | null {
  if (signal.direction === "NO_TRADE") return null;
  const agree = signal.modes.filter((m) => signal.verdicts[m]?.direction === signal.direction).length;
  return `${agree} of ${signal.modes.length} modes agree`;
}

export function riskMeter(deployed: number, cap: number): { pct: number; over: boolean } {
  if (!cap) return { pct: 0, over: false };
  return { pct: Math.min(100, Math.round((deployed / cap) * 100)), over: deployed > cap };
}

/**
 * The realised side of the IV/RV ratio, in the same units as `iv_pct`. The engine stores the
 * ratio, not the two legs, so realised vol is implied back out of it: iv_pct / (iv_pct / rv).
 * Null rather than a guess when the ratio is missing or nonsensical.
 */
export function realizedIvPct(ivPct: number, ivRv: number | null | undefined): number | null {
  if (ivRv === null || ivRv === undefined || ivRv <= 0) return null;
  const realized = ivPct / ivRv;
  return Number.isFinite(realized) ? realized : null;
}

export function changedSettings(saved: Settings, draft: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof Settings)[]) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(draft[key])) out[key] = draft[key];
  }
  return out as Partial<Settings>;
}

/** The backtest edge gate, as the engine applies it: enough trades, positive expectancy. */
export function wouldPass(cell: EdgeCell, minN: number, minExpectancy: number): boolean {
  return cell.n >= minN && cell.expectancy > minExpectancy;
}
