import type { FunnelGate } from "../lib/funnel";
import { useTemplate } from "../lib/templates";
import { GATE_ICONS } from "./Icons";

/**
 * The six gates as a left-to-right strip: what each one did in the cycle on screen. The rate is
 * throughput — of the tickers that reached this gate, how many came out the other side — so a
 * gate that turns most of the board back reads as the work it is doing, not as a failure.
 */

/** What each gate is looking for, in the order it looks. Short enough to sit under a name. */
const RULE: Record<string, string> = {
  Signal: "A mode fires and they agree on a side",
  "Spread fits": "Width, open interest and the risk cap",
  "Backtest edge": "Expectancy over the sample for the modes that fired",
  "Risk limits": "Slots, ticker already held, deployed risk",
  "AI review": "A verdict that clears the trade to go live",
  "Not a repeat": "Nothing alerted inside the cooldown",
};

export function GateFunnel({ gates }: { gates: FunnelGate[] }) {
  const minimal = useTemplate() === "minimal";

  return (
    <ol
      className={
        minimal
          ? "grid grid-cols-1 gap-2 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1300px]:grid-cols-6"
          : // The desk sets the six as columns of one ruled strip — the treatment it already gives
            // the funnel's argument on Learn — rather than six boxes.
            "grid grid-cols-1 gap-x-4 gap-y-5 border-t border-rule pt-4 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1300px]:grid-cols-6"
      }
    >
      {gates.map((g) => (
        <GateTile key={g.index} gate={g} minimal={minimal} />
      ))}
    </ol>
  );
}

function GateTile({ gate, minimal }: { gate: FunnelGate; minimal: boolean }) {
  const reached = gate.rate !== null;
  // Through is what the bar measures; the chip says it in words as well, since the bar alone
  // would leave the number unread.
  const fill = gate.rate ?? 0;
  const tone = !reached
    ? "text-ink-2"
    : gate.stopped + gate.errored === 0
      ? "text-profit"
      : "text-warn";

  return (
    <li
      className={
        minimal
          ? "gate-tile flex flex-col bg-well"
          : "flex flex-col border-l border-rule-strong pl-3"
      }
    >
      {/* At six columns the code and the rate cannot share a line, so the rate drops below it
          rather than the code being cut: an ellipsised `02 // TR…` says less than the full word
          does, and the tiles already run to different heights when a name wraps. */}
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="eyebrow whitespace-nowrap text-accent">
          {String(gate.index).padStart(2, "0")} // {SHORT[gate.label] ?? gate.label}
        </span>
        <span className={`eyebrow ml-auto shrink-0 whitespace-nowrap tabular-nums ${tone}`}>
          {reached ? `${gate.rate}%` : "—"}
        </span>
      </span>

      <span className="mt-1.5 flex items-center gap-2">
        <span
          className={
            minimal ? "gate-icon" : "flex h-4 w-4 shrink-0 items-center justify-center text-ink-2"
          }
        >
          {GATE_ICONS[gate.label]}
        </span>
        <span className="font-display text-[13px] font-semibold text-ink">{gate.label}</span>
      </span>

      <span className="mt-1 min-h-[2.7em] text-[11px] leading-[1.35] text-ink-2">
        {RULE[gate.label] ?? ""}
      </span>

      {/* The bar is the rate; the track stays visible at 0 so a stopped gate still reads as a gate.
          The desk draws bars flat against the page rather than in a pill, so there it is a hairline
          rule that fills. */}
      {minimal ? (
        <span className="meter-track mt-2 block" aria-hidden="true">
          <span
            className={`meter-bar block h-full ${gate.stopped + gate.errored === 0 ? "bg-profit" : "bg-warn"}`}
            style={{ width: `${fill}%` }}
          />
        </span>
      ) : (
        <span className="mt-2 block h-1 bg-rule" aria-hidden="true">
          <span
            className={`block h-full ${gate.stopped + gate.errored === 0 ? "bg-profit" : "bg-warn"}`}
            style={{ width: `${fill}%` }}
          />
        </span>
      )}

      <span className="mt-1.5 text-[11px] text-ink-2">
        {gate.off
          ? "Switched off in Settings"
          : reached
            ? <Counts reached={gate.reached} through={gate.through} stopped={gate.stopped} errored={gate.errored} />
            : "Nothing got this far"}
      </span>
    </li>
  );
}

/** The tile's numbers, as a screen reader reads them anyway — the bar is decoration. */
function Counts({ reached, through, stopped, errored }: {
  reached: number; through: number; stopped: number; errored: number;
}) {
  return (
    <>
      {through}/{reached} through
      {stopped > 0 && ` · ${stopped} stopped`}
      {errored > 0 && ` · ${errored} errored`}
    </>
  );
}

const SHORT: Record<string, string> = {
  Signal: "SIGNAL",
  "Spread fits": "TRADEABLE",
  "Backtest edge": "EDGE",
  "Risk limits": "RISK",
  "AI review": "AI",
  "Not a repeat": "DEDUPE",
};
