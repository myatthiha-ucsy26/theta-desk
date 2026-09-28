import type { Position } from "@/lib/infra/api";
import { formatDate } from "@/lib/infra/time";
import { formatMoney, spreadLabel } from "@/lib/domain/views";

export function ClosedRow({ trade }: { trade: Position }) {
  const pnl = trade.close_pnl;
  return (
    <tr>
      <th scope="row" className="py-2 pr-3 text-left font-display text-base font-semibold text-ink">
        {trade.ticker}
      </th>
      <td className="py-2 pr-3 text-ink-2">
        {spreadLabel(trade.direction)} {formatMoney(trade.short_strike, { signed: false })}/
        {formatMoney(trade.long_strike, { signed: false })}
      </td>
      <td className="num px-2 py-2 text-ink-2">{trade.contracts}</td>
      <td className="px-2 py-2 text-ink-2">{formatDate(trade.entry_date)}</td>
      <td className="px-2 py-2 text-ink-2">{formatDate(trade.close_date)}</td>
      <td
        className={`num px-2 py-2 ${
          pnl === null ? "text-ink-2" : pnl < 0 ? "text-loss" : "text-profit"
        }`}
      >
        {formatMoney(pnl, { signed: true })}
      </td>
      <td className="px-2 py-2 text-ink-2">{trade.mode}</td>
    </tr>
  );
}
