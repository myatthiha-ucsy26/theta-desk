import { gateStateWords, type GateCell } from "../lib/scan";

// Six labelled cells under a row: which gate, whether it passed, and the number it read.
// The colour bar in the table says the same thing in one glance; this says it in words, which
// is what a card has room for.
const WORD: Record<GateCell["state"], string> = {
  passed: "PASS",
  skipped: "SKIP",
  stopped: "STOP",
  error: "ERROR",
  "not-reached": "—",
};

const TONE: Record<GateCell["state"], string> = {
  passed: "text-profit",
  skipped: "text-ink-2",
  stopped: "text-critical",
  error: "text-critical",
  "not-reached": "text-ink-2",
};

export function GateMatrix({ cells }: { cells: GateCell[] }) {
  return (
    <ol className="grid grid-cols-2 gap-1.5 min-[900px]:grid-cols-3 min-[1300px]:grid-cols-6">
      {cells.map((c) => (
        <li
          key={c.index}
          role="img"
          aria-label={`${c.label}: ${gateStateWords(c.state)}`}
          className="gate-cell flex min-w-0 flex-col"
        >
          <span className="eyebrow whitespace-nowrap text-ink-2">
            G{c.index}:{c.code}
          </span>
          <span className="mt-0.5 flex items-baseline gap-1.5 text-[11px]">
            <span className={`shrink-0 font-semibold uppercase tracking-[0.04em] ${TONE[c.state]}`}>
              {WORD[c.state]}
            </span>
            {c.detail && (
              <span className="min-w-0 truncate text-ink-2" title={c.detail}>
                {c.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}