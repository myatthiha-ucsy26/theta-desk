import type { ReactNode } from "react";
import type { Direction } from "../lib/api";
import { takeProfit } from "../lib/bot";
import { formatDate } from "../lib/time";
import { useGreeks } from "../lib/useGreeks";
import {
  formatMoney,
  formatPct,
  formatPreciseMoney,
  formatShares,
  formatStrike,
  spreadLabel,
} from "../lib/views";
import { Metric } from "./Metric";
import { StatusBadge, type Tone } from "./StatusBadge";

/**
 * A greek is a whole priced grid, and /api/payoff reads the chain through OpenD to build one. The
 * mark beside it moves on every book tick; the greeks move far more slowly, so they are read on a
 * slower clock rather than spending an OpenD snapshot per position per tick.
 */
export const GREEKS_POLL_MS = 60000;

const DAY_MS = 86400000;

/** Calendar days from today to an expiry date, matching the engine's own date subtraction. */
export function daysUntil(expiry: string, now: Date): number | null {
  const parts = expiry.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/** Whole days since an instant or a date, floored: the card counts completed days, not part days. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
}

/** The leg word, which is the whole of what the direction says about the contract. */
const legWord = (direction: Direction) => (direction === "SELL_CALL" ? "CALL" : "PUT");

/**
 * The spine class for a direction: green for the put side, the accent for the call side. Exported
 * so the closed book wears the same spine on the same card rather than a second rule that drifts.
 */
export const spineClass = (direction: Direction) =>
  direction === "SELL_CALL" ? "spine-call" : "spine-put";

export interface SpreadCardProps {
  ticker: string;
  direction: Direction;
  shortStrike: number;
  longStrike: number;
  contracts: number;
  expiry: string;
  /** What the spread was sold for, or null while it has not filled. */
  credit: number | null;
  /** Cost to close now. Undefined until the book has priced this one. */
  mark: number | undefined;
  /** When it was opened: an instant on the live book, a date on the paper one. */
  enteredAt: string | null;
  /** The share of the credit the desk hands back to close, from settings. */
  tpPct: number;
  badges: { tone: Tone; label: string }[];
  status: string;
  actions: ReactNode;
}

/**
 * One credit spread as a card: what it was sold for, what it costs to buy back, how far that is
 * from the exit, and the two sensitivities that explain the wait.
 *
 * The live and paper books keep their figures differently but mean the same things by them, so
 * both render this one card rather than two that drift apart. Every figure here is a book's or
 * the pricer's: the mockup that shaped it also carried IV crush and a win probability, and nothing
 * in the app measures either, so they are absent rather than guessed.
 */
export function SpreadCard({
  ticker,
  direction,
  shortStrike,
  longStrike,
  contracts,
  expiry,
  credit,
  mark,
  enteredAt,
  tpPct,
  badges,
  status,
  actions,
}: SpreadCardProps) {
  const g = useGreeks(
    { ticker, direction, shortStrike, longStrike, credit, contracts, expiry },
    GREEKS_POLL_MS,
  );

  const now = Date.now();
  const dte = daysUntil(expiry, new Date(now));
  const heldDays = daysSince(enteredAt, now);

  const pnl = credit !== null && mark !== undefined ? (credit - mark) * 100 * contracts : null;
  const maxProfit = credit === null ? null : credit * 100 * contracts;
  const pnlPct = pnl !== null && maxProfit ? (pnl / maxProfit) * 100 : null;

  const tp = takeProfit(credit, tpPct);
  // How far the mark has travelled from the sale price towards the buy-back target. Null until
  // there is both a mark and a target to measure between, and when the target sits at or above
  // the sale price the denominator collapses, so the reading is withheld rather than inverted.
  const span = credit !== null && tp !== null ? credit - tp : 0;
  const progress = credit !== null && mark !== undefined && span > 0 ? (credit - mark) / span : null;

  const theta = g.data?.theta ?? null;

  return (
    <li className={`pos-card ${spineClass(direction)} flex min-w-0 flex-col gap-3 border border-rule`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="font-display text-[17px] font-semibold text-ink">{ticker}</span>
        <span className="eyebrow">{spreadLabel(direction)} spread</span>
        {badges.map((b) => (
          <StatusBadge key={b.label} tone={b.tone} label={b.label} />
        ))}
        <span className="ml-auto flex items-baseline gap-2">
          <span
            className={`num font-display text-[17px] font-semibold ${
              pnl === null ? "text-ink-2" : pnl < 0 ? "text-loss" : "text-profit"
            }`}
          >
            {formatMoney(pnl, { signed: true })}
          </span>
          {pnlPct !== null && <span className="num text-sm text-ink-2">{formatPct(pnlPct)}</span>}
        </span>
      </div>

      <p className="text-sm text-ink-2">
        {formatStrike(shortStrike)} / {formatStrike(longStrike)} {legWord(direction)}
        {contracts === 1 ? "" : "s"} · {dte ?? "—"} DTE
        {heldDays !== null && ` (entered ${heldDays}d ago`}
        {heldDays !== null && dte !== null && ` · ${dte}d left)`}
        {heldDays !== null && dte === null && ")"} · Exp {formatDate(expiry)}
      </p>

      <p className="text-sm text-ink">
        TP target: {tp === null ? "—" : formatStrike(tp)}
        <span className="text-ink-2"> (current {mark === undefined ? "—" : formatStrike(mark)})</span>
      </p>

      <dl className="pos-strip grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Metric
          label="Entry → mark"
          value={`${credit === null ? "—" : formatStrike(credit)} → ${
            mark === undefined ? "—" : formatStrike(mark)
          }`}
        />
        <Metric label="Delta · net" value={g.data ? formatShares(g.data.delta) : "—"} />
        <Metric
          label="Theta harvest"
          value={theta === null ? "—" : `${formatPreciseMoney(theta)}/d`}
          tone={theta === null ? undefined : theta > 0 ? "profit" : theta < 0 ? "loss" : undefined}
        />
      </dl>

      <div>
        {/* The reading rides the label's line rather than sitting under the bar: the bar is there to
            be glanced at, and the number that goes with it reads best beside the words it answers.
            The target is named on the line above, so it is not named a second time here. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="eyebrow">Take-profit progress</p>
          <p className="text-xs text-ink-2">
            {progress === null
              ? "Unmeasured until a mark and a target both land."
              : `${formatPct(progress * 100)} toward trigger`}
          </p>
        </div>
        <div className="meter-track mt-1.5 h-2 w-full overflow-hidden border border-rule bg-well">
          <span
            aria-hidden="true"
            className="meter-bar block h-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, (progress ?? 0) * 100))}%` }}
          />
        </div>
      </div>

      <p className="text-sm text-ink-2">{status}</p>

      <div className="flex flex-wrap gap-2">{actions}</div>
    </li>
  );
}