// What the header shows on every screen. Pure; the components only draw it.
import type { Account, JournalRow, PaperBook } from "./api";
import { formatMoney, formatPct, riskMeter } from "./views";

export interface SpotQuote { ticker: string; spot: number; ts: string }

/** The newest spot the engine saw for each ticker. Not a live quote: it is as old as the scan. */
export function latestSpots(rows: JournalRow[]): SpotQuote[] {
  const byTicker = new Map<string, SpotQuote>();
  for (const r of rows) {
    const spot = r.decision.signal?.spot;
    if (spot === undefined) continue;
    const seen = byTicker.get(r.decision.ticker);
    if (!seen || r.ts > seen.ts) byTicker.set(r.decision.ticker, { ticker: r.decision.ticker, spot, ts: r.ts });
  }
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Seconds for one full loop of the ticker tape: 4 per ticker, so the speed stays the same; never under 20. */
export function marqueeSeconds(count: number): number {
  return Math.max(20, count * 4);
}

/** The tape only moves when one copy of the price list is wider than the space for it. */
export function shouldScroll(contentWidth: number, viewportWidth: number): boolean {
  return contentWidth > viewportWidth;
}

export interface StatCard {
  label: string;
  value: string;
  note: string;
  tone?: "profit" | "loss";
  /** 0-100, drawn as a bar under the card. */
  meter?: number;
  over?: boolean;
}

const pct = (part: number, whole: number) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

export function statCards(book: PaperBook | null, maxOpen: number | null): StatCard[] {
  const s = book?.stats;
  if (!s) {
    return ["Realised P&L", "Win rate", "Open positions", "Risk deployed"].map((label) => ({
      label, value: "—", note: "",
    }));
  }
  const risk = riskMeter(s.deployed_risk, s.risk_cap);
  return [
    {
      label: "Realised P&L",
      value: formatMoney(s.total_pnl, { signed: true }),
      note: "Closed paper trades",
      tone: s.total_pnl > 0 ? "profit" : s.total_pnl < 0 ? "loss" : undefined,
    },
    {
      label: "Win rate",
      value: formatPct(s.win_rate * 100),
      note: `${s.wins} ${s.wins === 1 ? "win" : "wins"} / ${s.losses} ${s.losses === 1 ? "loss" : "losses"}`,
      meter: Math.round(s.win_rate * 100),
    },
    {
      label: "Open positions",
      value: String(s.open_count),
      note: maxOpen === null ? "" : `of ${maxOpen} allowed`,
      meter: maxOpen === null ? undefined : pct(s.open_count, maxOpen),
    },
    {
      label: "Risk deployed",
      value: formatMoney(s.deployed_risk, { signed: false }),
      note: `of ${formatMoney(s.risk_cap, { signed: false })} cap`,
      meter: risk.pct,
      over: risk.over,
    },
  ];
}

/** The two figures from the account worth a tile. Balances only; these tiles never trade.

    The live account reports what it is worth and what it has made. The paper account holds
    nothing at a broker, so there is no net value or unrealised P&L to read off it: it reports
    the cash it started with and the power left after the risk it has deployed. */
export function accountCards(account: Account | null): StatCard[] {
  if (!account) {
    return ["Net value", "Unrealised P&L"].map((label) => ({ label, value: "—", note: "" }));
  }
  if (account.account === "paper") {
    return [
      { label: "Paper cash", value: formatMoney(account.cash, { signed: false }), note: account.currency },
      { label: "Buying power", value: formatMoney(account.power ?? 0, { signed: false }), note: "simulated" },
    ];
  }
  const pl = account.unrealized_pl ?? 0;
  const open = account.open_count ?? 0;
  return [
    { label: "Net value", value: formatMoney(account.net_value ?? 0, { signed: false }), note: account.currency },
    {
      label: "Unrealised P&L",
      value: formatMoney(pl, { signed: true }),
      note: `${open} open ${open === 1 ? "position" : "positions"}`,
      tone: pl > 0 ? "profit" : pl < 0 ? "loss" : undefined,
    },
  ];
}
