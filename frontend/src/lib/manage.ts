// The Manage cockpit's portfolio figures, aggregated from books the API already returns.
//
// These read the bot's live book -- the spreads actually held on the real account -- rather than
// the paper book, because that is the only book "credit deployed against NAV" can mean anything
// for. Nothing here is a new measurement: each number is a sum of fields app.py already computes,
// or a countdown to a rule cs_autotrade.py enforces.
import type { Account, BotStatus, LiveTrade } from "./api";
import { newYorkTime } from "./time";

export interface Exposure {
  /** Spreads the bot is holding. */
  count: number;
  /** Of those, how many have no mark yet. Their P&L counts as zero below. */
  unmarked: number;
  /** What the book was paid: the credit on every spread, summed. */
  credit: number;
  /** What the broker holds against them: each spread's full width, per cs_autotrade. */
  margin: number;
  /** Margin as a share of the real account's net value, or null without a readable account. */
  navPct: number | null;
  /** Mark-to-model P&L across the open book. */
  unrealized: number;
  /**
   * Unrealised P&L as a share of the credit it is being earned against -- the same quantity
   * cs_manage.PROFIT_TAKE_FRACTION measures per position when it takes profit at 50%.
   */
  capturedPct: number | null;
  realized: number;
  wins: number;
  losses: number;
  winRate: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * What one live spread contributes. A spread is 100 shares a contract, priced in dollars.
 * Margin is the spread's full width rather than the width less the credit, because that is what
 * cs_autotrade.MARGIN_PER_SPREAD holds back and what the slot ladder counts against.
 */
function leg(t: LiveTrade, mark: number | undefined) {
  // Nothing is held, and nothing is earned, against an order that has not filled.
  if (t.credit === null) return { credit: 0, margin: 0, pnl: null };
  const size = 100 * t.contracts;
  return {
    credit: t.credit * size,
    margin: t.width * size,
    // Null until the position is marked: the credit is known at the fill, the exit price is not.
    pnl: mark === undefined ? null : (t.credit - mark) * size,
  };
}

/** The bot's live book as one set of figures. Null while the bot status is still loading. */
export function exposure(bot: BotStatus | null, account: Account | null): Exposure | null {
  if (!bot) return null;
  const legs = bot.active.map((t) => leg(t, bot.marks[t.id]));
  const credit = sum(legs.map((l) => l.credit));
  const margin = sum(legs.map((l) => l.margin));
  const unrealized = sum(legs.map((l) => l.pnl ?? 0));
  // Cancelled entries never took a credit, so they are not a result either way.
  const settled = bot.closed.filter((t) => t.pnl !== null);
  const wins = settled.filter((t) => (t.pnl ?? 0) > 0).length;
  return {
    count: bot.active.length,
    unmarked: legs.filter((l) => l.pnl === null).length,
    credit,
    margin,
    // The paper account reports no net value, so this share is simply not available there.
    navPct: account?.net_value && account.net_value > 0 ? (margin / account.net_value) * 100 : null,
    unrealized,
    capturedPct: credit > 0 ? (unrealized / credit) * 100 : null,
    realized: sum(bot.closed.map((t) => t.pnl ?? 0)),
    wins,
    losses: settled.length - wins,
    winRate: settled.length > 0 ? wins / settled.length : 0,
  };
}

/**
 * cs_autotrade.EXPIRY_CLOSE_AT: the New York wall-clock time the bot force-closes a spread on
 * its expiry day. Repeated here because the API does not publish it; keep the two in step.
 */
export const EXPIRY_CLOSE = { hour: 15, minute: 0 };

export interface Settlement {
  /** The nearest expiry in the book, "YYYY-MM-DD", or null with nothing open. */
  expiry: string | null;
  /** How many spreads expire at it. */
  count: number;
  /** The instant they are force-closed at: 15:00 New York on that expiry day. */
  at: Date | null;
  /** Milliseconds until then. Goes negative once the close has passed, if the book still lists it. */
  msLeft: number | null;
}

/** The book's next forced close: the nearest expiry, at cs_autotrade's close time. */
export function settlement(active: { expiry: string }[], now: Date = new Date()): Settlement {
  if (active.length === 0) return { expiry: null, count: 0, at: null, msLeft: null };
  // ISO dates sort the way they read, so the smallest is the nearest.
  const expiry = active.reduce((a, t) => (t.expiry < a ? t.expiry : a), active[0].expiry);
  const at = newYorkTime(expiry, EXPIRY_CLOSE.hour, EXPIRY_CLOSE.minute);
  return {
    expiry,
    count: active.filter((t) => t.expiry === expiry).length,
    at,
    msLeft: at.getTime() - now.getTime(),
  };
}

/** "2d 04h", "04:12:08" inside a day, "closed" once the instant has passed, "—" with no expiry. */
export function countdown(msLeft: number | null): string {
  if (msLeft === null) return "—";
  if (msLeft <= 0) return "closed";
  const total = Math.floor(msLeft / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h`;
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}