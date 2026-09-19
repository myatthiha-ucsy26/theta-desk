import type { LegQuote, Spread } from "../lib/api";
import { formatPct, formatStrike } from "../lib/views";

const CARD: Record<"short" | "long", string> = {
  short: "border-profit/40 bg-profit/10",
  long: "border-loss/40 bg-loss/10",
};
const CHIP: Record<"short" | "long", string> = {
  short: "bg-profit text-sheet",
  long: "bg-loss text-sheet",
};

const count = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
const quote = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);

function LegRow({
  role,
  leg,
  side,
  note,
}: {
  role: "short" | "long";
  leg: LegQuote;
  side: "put" | "call";
  /** What the leg is doing in the trade, when the spread has that to say. */
  note: string | null;
}) {
  const delta = leg.delta === null ? "Delta: —" : `Delta: ${leg.delta.toFixed(3)}`;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border px-3 py-2 ${CARD[role]}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${CHIP[role]}`}>
          {role.toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-display text-[15px] font-semibold text-ink">
            {formatStrike(leg.strike)} {side.toUpperCase()}
          </span>
          <span className="text-[11px] text-ink-2">
            {delta}
            {note && ` • ${note}`}
          </span>
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="font-display text-sm font-semibold tabular-nums text-ink">
          Bid {quote(leg.bid)} / Ask {quote(leg.ask)}
        </span>
        <span className="text-[11px] tabular-nums text-ink-2">
          OI: {count(leg.oi)} • Vol: {count(leg.volume)}
        </span>
      </span>
    </div>
  );
}

/**
 * The two legs the spread is built from, each with the quotes it was chosen on: what it was
 * bid at, how deep the book is, and — on the long side — what the tail costs to carry.
 *
 * Absent when the signal predates the legs carrying their own quotes; the spread's own
 * summary still stands on its own.
 */
export function LegCards({ spread }: { spread: Spread }) {
  const { short_leg: short, long_leg: lng } = spread;
  if (!short || !lng) return null;
  return (
    <div className="flex flex-col gap-2">
      <LegRow
        role="short"
        leg={short}
        side={spread.side}
        note={spread.pop_pct == null ? null : `POP: ${formatPct(spread.pop_pct)}`}
      />
      <LegRow role="long" leg={lng} side={spread.side} note="Protective tail" />
    </div>
  );
}