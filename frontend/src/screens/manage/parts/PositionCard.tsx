import { useEffect, useState } from "react";
import { Metric } from "@/components/shared/Metric";
import { SpreadCard } from "@/components/manage/SpreadCard";
import type { OpenPosition, Position } from "@/lib/infra/api";
import type { Tone } from "@/lib/domain/views";
import { countdown } from "@/lib/domain/manage";
import { formatDate } from "@/lib/infra/time";
import { formatMoney, spreadLabel } from "@/lib/domain/views";
import { ACTION_BUTTON, CONFIRM_BUTTON } from "./constants";

/**
 * One open paper position, on the same card the live book uses.
 *
 * The paper book marks to model exactly as the live one does -- P&L is the credit less what it
 * costs to buy back -- so the cost to close is that P&L divided back out. The pricer behind it is
 * the same one, which is what makes the greeks on both cards comparable.
 */
export function PositionCard({
  p,
  tpPct,
  selected,
  onSelect,
  confirming,
  onConfirm,
  onKeep,
  onClose,
}: {
  p: OpenPosition;
  tpPct: number;
  selected: boolean;
  onSelect: () => void;
  confirming: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const mark = p.mtm_pnl === null ? undefined : p.credit - p.mtm_pnl / (100 * p.contracts);

  return (
    <SpreadCard
      ticker={p.ticker}
      direction={p.direction}
      shortStrike={p.short_strike}
      longStrike={p.long_strike}
      contracts={p.contracts}
      expiry={p.expiry}
      credit={p.credit}
      mark={mark}
      enteredAt={p.entry_date}
      tpPct={tpPct}
      badges={flags(p)}
      status={`Paper trade, ${p.mode} — no order is resting.`}
      actions={
        confirming ? (
          <>
            <button type="button" onClick={onClose} className={CONFIRM_BUTTON}>
              Confirm close at current price
            </button>
            <button type="button" onClick={onKeep} className={ACTION_BUTTON}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={selected}
              onClick={onSelect}
              className={`whitespace-nowrap ${
                selected ? "border-accent text-ink" : "border-rule text-ink-2"
              } border px-3 py-1.5 text-sm`}
            >
              Inspect 3D payoff
            </button>
            <button type="button" onClick={onConfirm} className={ACTION_BUTTON}>
              Close position
            </button>
          </>
        )
      }
    />
  );
}

export function ClosedCard({ trade }: { trade: Position }) {
  const pnl = trade.close_pnl;
  return (
    <li className="pos-card flex min-w-0 flex-col gap-2 border border-rule">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold text-ink">{trade.ticker}</span>
        <span className="text-sm text-ink-2">
          {spreadLabel(trade.direction)} {formatMoney(trade.short_strike, { signed: false })}/
          {formatMoney(trade.long_strike, { signed: false })}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Metric label="Contracts" value={String(trade.contracts)} />
        <Metric label="Entry" value={formatDate(trade.entry_date)} />
        <Metric label="Closed" value={formatDate(trade.close_date)} />
        <Metric
          label="Realised P&L"
          value={formatMoney(pnl, { signed: true })}
          tone={pnl === null ? "muted" : pnl < 0 ? "loss" : "profit"}
        />
        <Metric label="Mode" value={trade.mode} />
      </dl>
    </li>
  );
}

export function flags(p: OpenPosition): { tone: Tone; label: string }[] {
  const out: { tone: Tone; label: string }[] = [];
  if (p.profit_take_hit) out.push({ tone: "good", label: "Take profit (50% reached)" });
  if (p.short_breached) out.push({ tone: "critical", label: "Short strike breached" });
  if (p.days_left <= 2) {
    out.push({ tone: "warn", label: `Expires in ${p.days_left} ${p.days_left === 1 ? "day" : "days"}` });
  }
  if (p.spot === null) out.push({ tone: "neutral", label: "No quote" });
  return out;
}

/**
 * The wait until the next forced close, ticking on its own so the position tables below are not
 * re-rendered once a second to move one line of text.
 */
export function SettlementClock({ at }: { at: Date | null }) {
  const target = at?.getTime() ?? null;
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (target === null) return;
    const tick = () => setMsLeft(target - Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);

  return <span className="num">{countdown(msLeft)}</span>;
}
