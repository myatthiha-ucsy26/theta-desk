// What each gate did in the cycle on screen, for the pipeline strip above the board. Pure.
import type { JournalRow } from "./api";
import { GATES, gateStates } from "./views";

export interface FunnelGate {
  /** Position in the pipeline, 1-based, as the strip numbers it. */
  index: number;
  label: string;
  /** Rows that got as far as this gate. */
  reached: number;
  /** Rows that came through — passed it, or skipped it because it is switched off. */
  through: number;
  /** Rows it turned back. */
  stopped: number;
  /** Rows that failed here on an error rather than a verdict. */
  errored: number;
  /** Through out of reached, as a whole percentage. Null when nothing reached the gate. */
  rate: number | null;
  /** Every row that reached it skipped it: the gate is switched off in Settings. */
  off: boolean;
}

/** One entry per gate, whether or not anything reached it. */
export function funnel(rows: JournalRow[]): FunnelGate[] {
  return GATES.map((gate, i) => {
    const reached = rows.map((r) => gateStates(r.decision)[i]).filter((s) => s !== "not-reached");
    const count = (state: string) => reached.filter((s) => s === state).length;
    const skipped = count("skipped");
    return {
      index: i + 1,
      label: gate.label,
      reached: reached.length,
      through: count("passed") + skipped,
      stopped: count("stopped"),
      errored: count("error"),
      rate: reached.length === 0 ? null : Math.round(((reached.length - count("stopped") - count("error")) / reached.length) * 100),
      off: reached.length > 0 && skipped === reached.length,
    };
  });
}
