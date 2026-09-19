import type { LiveTrade } from "../lib/api";
import { takeProfit } from "../lib/bot";
import { formatStrike } from "../lib/views";
import { SpreadCard } from "./SpreadCard";
import type { Tone } from "./StatusBadge";

const STATE_TONE: Record<LiveTrade["state"], Tone> = {
  entering: "warn",
  open: "good",
  closing: "warn",
  closed: "neutral",
  entry_cancelled: "critical",
};

export interface BotPositionCardProps {
  trade: LiveTrade;
  /** Cost to close, from the bot's marks. Undefined until the book has priced this one. */
  mark: number | undefined;
  tpPct: number;
  inspecting: boolean;
  onInspect: () => void;
}

/** One spread the bot holds on the real account, on the card both books share. */
export function BotPositionCard({
  trade,
  mark,
  tpPct,
  inspecting,
  onInspect,
}: BotPositionCardProps) {
  const tp = takeProfit(trade.credit, tpPct);
  const tif = trade.tp_tif ? `${trade.tp_tif} ` : "";
  const status =
    trade.tp_order_id && tp !== null
      ? `Resting ${tif}order: buy to close @ ${formatStrike(tp)}`
      : trade.state === "open"
        ? "Open, no resting order"
        : `State: ${trade.state}`;

  return (
    <SpreadCard
      ticker={trade.ticker}
      direction={trade.direction}
      shortStrike={trade.short_strike}
      longStrike={trade.long_strike}
      contracts={trade.contracts}
      expiry={trade.expiry}
      credit={trade.credit}
      mark={mark}
      enteredAt={trade.filled_at}
      tpPct={tpPct}
      badges={[{ tone: STATE_TONE[trade.state], label: trade.state }]}
      status={`${status}${trade.sl_hits > 0 ? ` · stop-loss repriced ×${trade.sl_hits}` : ""}`}
      actions={
        <button
          type="button"
          aria-pressed={inspecting}
          onClick={onInspect}
          className={`whitespace-nowrap ${
            inspecting ? "border-accent text-ink" : "border-rule text-ink-2"
          } border px-3 py-1.5 text-sm`}
        >
          Inspect 3D payoff
        </button>
      }
    />
  );
}