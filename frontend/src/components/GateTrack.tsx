import type { Decision, Stage } from "../lib/api";
import { gateStateWords } from "../lib/scan";
import { GATES, gateStates, type GateState } from "../lib/views";

// Six cells of 42px inside a 1px border. The header shares this exact width and border box, so
// each label sits over the segment it names. Square, like the rest of the page: no rounding.
const TRACK = "w-[254px] border";
const CELL_W = 42;

// The header's labels are shorter than the spec's gate names so each one fits its own 42px cell.
// The full names stay in the caption under the table.
const SHORT: Record<Exclude<Stage, "alert">, string> = {
  signal: "Signal",
  tradeable: "Spread",
  edge: "Edge",
  risk: "Risk",
  ai: "AI",
  dedupe: "Repeat",
};

const CELL: Record<GateState, string> = {
  passed: "bg-profit",
  stopped: "bg-transparent",
  error: "bg-critical",
  "not-reached": "bg-transparent",
  // The pipeline carried on past this gate without running it, so it stays in the passed run
  // but lighter. A hatch here would read as a break in a row that actually passed.
  skipped: "bg-profit/40",
};

/** Names each segment, directly over it. */
export function GateTrackHeader() {
  return (
    <div className={`flex border-transparent normal-case tracking-normal ${TRACK}`}>
      {GATES.map((gate) => (
        <span key={gate.stage} className="flex-1 text-center text-[10px] text-ink-2">
          {SHORT[gate.stage]}
        </span>
      ))}
    </div>
  );
}

// Six cells joined into one track: how far this ticker got, and where it stopped.
export function GateTrack({ decision }: { decision: Decision }) {
  const states = gateStates(decision);
  return (
    <div className={`flex h-4 shrink-0 overflow-hidden border-rule ${TRACK}`}>
      {GATES.map((gate, i) => {
        const state = states[i];
        const words = gateStateWords(state);
        return (
          <span
            key={gate.stage}
            role="img"
            aria-label={`${gate.label}: ${words}`}
            title={`${gate.label}: ${words}`}
            style={{ width: CELL_W }}
            className={`relative border-r border-rule last:border-r-0 ${CELL[state]}`}
          >
            {(state === "stopped" || state === "error") && (
              <span
                aria-hidden="true"
                className={`absolute inset-0 flex items-center justify-center text-[11px] leading-none ${
                  state === "error" ? "text-sheet" : "text-ink"
                }`}
              >
                {state === "error" ? "!" : "✕"}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}