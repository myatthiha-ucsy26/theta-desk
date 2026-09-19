// Live bot view logic. Pure; the components only draw it.
import type { Tone } from "../components/StatusBadge";
import type { BotStatus, LiveTrade } from "./api";
import { formatMoney } from "./views";

export const EXIT_LABEL: Record<string, string> = {
  tp: "Take profit", sl: "Stop loss", ai: "AI exit", expiry: "Expiry day", manual: "Closed by you",
};

export function botBadge(b: BotStatus | null): { tone: Tone; label: string } {
  if (!b) return { tone: "neutral", label: "Bot —" };
  if (b.mode !== "auto") return { tone: "neutral", label: "Bot off" };
  if (b.paused) return { tone: "critical", label: `Bot paused: ${b.pause_reason}` };
  if (b.monitor.state === "error") return { tone: "critical", label: `Bot monitor error: ${b.monitor.last_error ?? ""}` };
  if (b.active.length) return { tone: "good", label: `Bot in trade (${b.active.length})` };
  return { tone: "good", label: "Bot watching" };
}

export function slotProgress(b: BotStatus): string {
  const slots = `${b.slots} ${b.slots === 1 ? "slot" : "slots"}`;
  return `Net bot profit ${formatMoney(b.net_pnl, { signed: true })} · ${slots} · next slot at ${formatMoney(b.next_slot_at, { signed: false })}`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The buy-back target: the share of the credit the desk is willing to hand back. */
export function takeProfit(credit: number | null, tpPct: number): number | null {
  return credit === null ? null : round2(credit * (1 - tpPct / 100));
}

export function exitLevels(t: LiveTrade, tpPct: number, slMultiple: number): { tp: number; sl: number } | null {
  if (t.credit === null) return null;
  return { tp: round2(t.credit * (1 - tpPct / 100)), sl: round2(t.credit * (1 + slMultiple)) };
}
