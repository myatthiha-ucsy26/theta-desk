import { PayoffChart } from "./PayoffChart";
import { StatusBadge } from "./StatusBadge";
import { Metric } from "./Metric";
import type { JournalRow } from "../lib/api";
import { gateCells, rowStatus, tradeFacts } from "../lib/scan";
import { formatMoney, formatPct, realizedIvPct, spreadLabel } from "../lib/views";
import { BTN } from "../lib/ui";

const AI_TONE = { CONFIRM: "good", CAUTION: "warn", AVOID: "critical" } as const;

/**
 * The row a person is looking at, opened out: the numbers behind it and what the engine said.
 * Every figure is read off the decision — this panel never guesses a value the engine did not
 * record, so a row that stopped early simply has fewer of them.
 */
export function QuickInspect({ row, onOpen }: { row: JournalRow; onOpen: () => void }) {
  const d = row.decision;
  const s = d.signal;
  const status = rowStatus(d);
  const facts = tradeFacts(d);

  const stop = gateCells(d).find((c) => c.state === "stopped" || c.state === "error");
  const realized = s ? realizedIvPct(s.iv_pct, s.iv_rv) : null;

  const readings: { label: string; value: string }[] = [
    { label: "RSI (14)", value: s?.indicators ? s.indicators.rsi.toFixed(1) : "—" },
    { label: "%B", value: s?.indicators ? s.indicators.pctb.toFixed(2) : "—" },
    { label: "IV rank", value: s?.iv_rank == null ? "building" : formatPct(s.iv_rank) },
    { label: "IV %ile", value: s ? formatPct(s.iv_pct) : "—" },
    { label: "Realised IV", value: realized === null ? "—" : formatPct(realized) },
    { label: "IV / RV", value: s?.iv_rv == null ? "—" : s.iv_rv.toFixed(2) },
    { label: "Return on risk", value: s?.spread?.roi_pct == null ? "—" : formatPct(s.spread.roi_pct) },
    { label: "Breakeven", value: s?.spread ? formatMoney(s.spread.breakeven, { signed: false }) : "—" },
    { label: "Spot", value: s ? formatMoney(s.spot, { signed: false }) : "—" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <StatusBadge {...status} />
        {stop && <span className="eyebrow">Gate {stop.index} of 6</span>}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {d.ticker}
        </h3>
        {facts.credit ? (
          <span className="font-display text-[20px] font-semibold leading-none text-profit">
            {facts.credit}
          </span>
        ) : (
          <span className="eyebrow">No spread</span>
        )}
      </div>
      <p className="eyebrow -mt-3">
        {s
          ? `${s.dte} DTE ${spreadLabel(d.direction)}${facts.strikes ? ` (${facts.strikes})` : ""}`
          : `${d.dte} DTE · never priced`}
      </p>

      <dl className="grid grid-cols-2 gap-2">
        {readings.map((r) => (
          <Metric key={r.label} label={r.label} value={r.value} />
        ))}
      </dl>

      {s?.spread && (
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">Expiry payoff</span>
          <PayoffChart spread={s.spread} spot={s.spot} />
        </div>
      )}

      {(d.ai_reason || d.ai_verdict) && (
        <div className="opinion-card flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <span className="eyebrow">Engine opinion</span>
            {d.ai_verdict && (
              <StatusBadge
                tone={AI_TONE[d.ai_verdict as keyof typeof AI_TONE] ?? "neutral"}
                label={d.ai_verdict}
              />
            )}
          </span>
          {/* No clamp: the verdict is the reason you opened the panel, and a cut-off reason is
              the one thing that makes it useless. It wraps and the panel grows instead. */}
          <p className="text-xs leading-[1.5] text-ink">{d.ai_reason ?? "No reason recorded."}</p>
        </div>
      )}

      <button type="button" onClick={onOpen} className={BTN}>
        Open in Study
      </button>
    </div>
  );
}