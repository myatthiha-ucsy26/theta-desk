// The demo desk's book: eight weeks of closed credit spreads and four open ones, generated from a
// fixed seed so the same story plays every time it is shown. Everything is simulated; nothing
// here was ever traded. Pure: every figure is a function of the seed and the moment asked about.
import type { Direction } from "../api";
import { spreadValue } from "./pricing";

/** The default watchlist, at about where each one traded when the demo was written. */
export const SPOTS: Record<string, number> = {
  SPY: 772.75, QQQ: 747.11, AAPL: 340.99, MSFT: 501.1, GOOGL: 349.93,
  AMZN: 253.26, META: 746.71, TSLA: 379.95, AVGO: 362.01, AMD: 622.45,
};
export const TICKERS = Object.keys(SPOTS);

/** Each name's vol, as a decimal: the index ETFs quiet, the high-beta names loud. */
export const SIGMA: Record<string, number> = {
  SPY: 0.16, QQQ: 0.2, AAPL: 0.26, MSFT: 0.24, GOOGL: 0.29,
  AMZN: 0.31, META: 0.36, TSLA: 0.55, AVGO: 0.42, AMD: 0.5,
};

const SEED = 20260924;
const DAY = 86_400_000;
const HISTORY_DAYS = 56;
const CLOSED_COUNT = 48;
/** Three losses in a row a few weeks back: a real book has a bad stretch, so this one does. */
const DRAWDOWN = new Set([17, 18, 19]);
const WIDTH = 5;
const FEE_PER_CONTRACT = 0.65;
/** While the demo is open, one more trade closes this often. */
const SESSION_STEP_MS = 45_000;

export interface DemoClosed {
  id: string; ticker: string; direction: Exclude<Direction, "NO_TRADE">;
  short: number; long: number; width: number; credit: number; contracts: number;
  openedAt: string; closedAt: string; expiry: string;
  exitReason: "tp" | "sl" | "expiry"; closeDebit: number; fees: number; pnl: number;
}

export interface DemoOpen {
  id: string; ticker: string; direction: Exclude<Direction, "NO_TRADE">;
  short: number; long: number; width: number; credit: number; contracts: number;
  openedAt: string; expiry: string; spot: number; sigma: number;
  /** What it costs per share to close right now. */
  mark: number;
  /** Unrealised P&L in dollars, after the fees paid to open. */
  pnl: number;
}

export interface DemoBook { closed: DemoClosed[]; open: DemoOpen[] }

/** mulberry32: small, fast and the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const step = (spot: number) => (spot >= 200 ? 5 : 2.5);
const roundTo = (x: number, s: number) => Math.round(x / s) * s;
const cents = (x: number) => Math.round(x * 100) / 100;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Strikes about `otm` out of the money, on the chain's own spacing, with a five-wide long leg. */
function strikes(spot: number, direction: DemoClosed["direction"], otm: number) {
  const s = step(spot);
  const short = direction === "SELL_PUT" ? roundTo(spot * (1 - otm), s) : roundTo(spot * (1 + otm), s);
  return { short, long: direction === "SELL_PUT" ? short - WIDTH : short + WIDTH };
}

/**
 * Where a name trades at a moment: its anchor, nudged by a slow wave, a medium one and a quick
 * flicker, so an open mark moves between two polls a few seconds apart, the way a live quote does.
 */
export function spotAt(ticker: string, ms: number): number {
  const base = SPOTS[ticker];
  const phase = ticker.charCodeAt(0) + ticker.length;
  return cents(base * (1 + 0.006 * Math.sin(ms / 90_000 + phase) + 0.002 * Math.sin(ms / 17_000 + phase * 2)
    + 0.0012 * Math.sin(ms / 4_000 + phase * 3)));
}

/**
 * One closed spread. Wins are taken at half the credit (the take-profit); losses are stopped at
 * twice it, and once in a while one runs to expiry near the long strike and costs most of the width.
 */
function closedTrade(rand: () => number, id: string, openedMs: number, capMs: number, forceLoss: boolean): DemoClosed {
  const ticker = TICKERS[Math.floor(rand() * TICKERS.length)];
  const direction = rand() < 0.7 ? "SELL_PUT" : "SELL_CALL";
  const spot = SPOTS[ticker] * (0.94 + rand() * 0.08);
  const { short, long } = strikes(spot, direction, 0.035 + rand() * 0.03);
  const credit = roundTo(0.8 + rand() * 0.8, 0.05);
  const contracts = rand() < 0.75 ? 1 : 2;
  const opened = openedMs - Math.floor(rand() * 5) * 3_600_000;
  const dte = rand() < 0.6 ? 7 : 14;
  const loss = forceLoss || rand() > 0.82;
  const runsToExpiry = loss && !forceLoss && rand() < 0.1;
  const closeDebit = loss ? (runsToExpiry ? cents(WIDTH * 0.85) : cents(credit * 2)) : cents(credit * 0.5);
  const heldDays = loss ? (runsToExpiry ? dte : 1 + Math.floor(rand() * 4)) : 1 + Math.floor(rand() * (dte - 2));
  const closedMs = Math.min(opened + heldDays * DAY, capMs);
  const fees = cents(FEE_PER_CONTRACT * 2 * 2 * contracts);
  return {
    id, ticker, direction, short, long, width: WIDTH, credit, contracts,
    openedAt: iso(opened), closedAt: iso(closedMs), expiry: isoDate(opened + dte * DAY),
    exitReason: loss ? (runsToExpiry ? "expiry" : "sl") : "tp",
    closeDebit, fees, pnl: cents((credit - closeDebit) * 100 * contracts - fees),
  };
}

/**
 * The book at `now`, for a demo that opened at `since`. The history is fixed; while the demo stays
 * open another trade closes every SESSION_STEP_MS, so realised P&L moves the way it does on a desk
 * that is trading. Each session trade has its own seed, so anyone watching the same minutes sees
 * the same trades close.
 */
export function demoBook(now: Date = new Date(), since: Date = now): DemoBook {
  const t0 = now.getTime();
  const rand = rng(SEED);

  const closed: DemoClosed[] = [];
  for (let i = 0; i < CLOSED_COUNT; i++) {
    const opened = t0 - (HISTORY_DAYS - (i * HISTORY_DAYS) / CLOSED_COUNT) * DAY;
    closed.push(closedTrade(rand, `demo-c${i + 1}`, opened, t0 - 3_600_000, DRAWDOWN.has(i)));
  }
  const sessionStart = since.getTime();
  const steps = Math.max(0, Math.floor((t0 - sessionStart) / SESSION_STEP_MS));
  for (let k = 1; k <= steps; k++) {
    const closedMs = sessionStart + k * SESSION_STEP_MS;
    const r = rng(SEED + k * 7919);
    const trade = closedTrade(r, `demo-s${k}`, closedMs - (2 + Math.floor(r() * 5)) * DAY, closedMs, false);
    closed.push({ ...trade, closedAt: iso(closedMs) });
  }

  // The open book: four names, opened over the last week, marked at this moment.
  const openSpecs: [string, DemoClosed["direction"], number, number, number][] = [
    ["SPY", "SELL_PUT", 0.035, 5, 9],
    ["MSFT", "SELL_PUT", 0.05, 3, 11],
    ["TSLA", "SELL_CALL", 0.09, 2, 12],
    ["AMD", "SELL_PUT", 0.08, 1, 13],
  ];
  const open: DemoOpen[] = openSpecs.map(([ticker, direction, otm, daysIn, daysLeft], i) => {
    const { short, long } = strikes(SPOTS[ticker], direction, otm);
    const credit = [1.35, 1.1, 1.55, 1.25][i];
    const contracts = i === 0 ? 2 : 1;
    const sigma = SIGMA[ticker];
    const spot = spotAt(ticker, t0);
    const expiryMs = t0 + daysLeft * DAY;
    const mark = cents(spreadValue(spot, short, long, daysLeft / 365, sigma, direction));
    const fees = cents(FEE_PER_CONTRACT * 2 * contracts);
    return {
      id: `demo-o${i + 1}`, ticker, direction, short, long, width: WIDTH, credit, contracts,
      openedAt: iso(t0 - daysIn * DAY), expiry: isoDate(expiryMs), spot, sigma, mark,
      pnl: cents((credit - mark) * 100 * contracts - fees),
    };
  });

  return { closed, open };
}
