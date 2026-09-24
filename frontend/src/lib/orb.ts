// What the Holo template's orb shows, read off whichever book the desk is trading. Pure; the
// canvas only draws it.
import type { Account, PaperBook } from "./api";

/** Past this many rings the orbits crowd into one band and stop being countable. */
export const MAX_RINGS = 8;

/** About one turn in 16 seconds: slow, but seen turning even with nothing open. */
export const IDLE_SPIN = 0.4;
const FULL_SPIN = 1.2;

export interface OrbParams {
  /** One orbit per open position. */
  rings: number;
  /** The glow: green-cyan while the book is up (realised on paper, unrealised live), rose while down. */
  tone: "profit" | "loss" | "flat";
  /** Radians a second: an idle drift with nothing deployed, a full turn-rate at the risk cap. */
  spin: number;
}

const toneOf = (pnl: number): OrbParams["tone"] => (pnl > 0 ? "profit" : pnl < 0 ? "loss" : "flat");

/**
 * On the live account the orb is the real book: its open positions and unrealised P&L. The live
 * account reports no deployed risk, so the spin follows the share of the position cap in use.
 * On paper it is the paper book, spinning with the share of the risk cap deployed.
 */
export function orbParams(
  stats: PaperBook["stats"] | null,
  account: Account | null = null,
  maxOpen: number | null = null,
): OrbParams {
  if (account?.account === "live") {
    const open = account.open_count ?? 0;
    const used = maxOpen ? Math.min(1, Math.max(0, open / maxOpen)) : 0;
    return {
      rings: Math.min(MAX_RINGS, Math.max(0, open)),
      tone: toneOf(account.unrealized_pl ?? 0),
      spin: IDLE_SPIN + (FULL_SPIN - IDLE_SPIN) * used,
    };
  }
  if (!stats) return { rings: 0, tone: "flat", spin: IDLE_SPIN };
  const used = stats.risk_cap > 0 ? Math.min(1, Math.max(0, stats.deployed_risk / stats.risk_cap)) : 0;
  return {
    rings: Math.min(MAX_RINGS, Math.max(0, stats.open_count)),
    tone: toneOf(stats.total_pnl),
    spin: IDLE_SPIN + (FULL_SPIN - IDLE_SPIN) * used,
  };
}
