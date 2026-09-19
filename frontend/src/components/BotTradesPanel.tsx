import { useEffect, useState } from "react";
import { api, type BotStatus, type LiveTrade } from "../lib/api";
import { EXIT_LABEL, exitLevels } from "../lib/bot";
import { useTemplate } from "../lib/templates";
import { formatDate, formatTime } from "../lib/time";
import { usePoll, type Poll } from "../lib/usePoll";
import { onSettingsSaved } from "../lib/settingsBus";
import { formatMoney, formatStrike, spreadLabel } from "../lib/views";
import { BotPositionCard } from "./BotPositionCard";
import { Metric } from "./Metric";
import { Panel } from "./Panel";
import { spineClass } from "./SpreadCard";
import { toast } from "../lib/toast";
import { BTN, BTN_DANGER } from "../lib/ui";

const POLL_MS = 15000;
const TH = "pb-1.5 pr-4";
const TD = "py-2 pr-4";

export interface BotTradesPanelProps {
  bot: Poll<BotStatus>;
  /** The spread whose payoff panel is open below, if it is one of these. */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** Which half of the book the panel is showing. All is the default, so nothing is hidden unasked. */
type BookView = "all" | "open" | "closed";

const VIEWS: { id: BookView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

/**
 * Spreads the bot opened on the real account, how they ended, and every order it sent.
 *
 * The live book arrives as a prop rather than a poll of its own: the exposure matrix above reads
 * the same endpoint, and two polls of it would print one spread's mark-to-model P&L twice, from
 * two snapshots taken seconds apart.
 */
export function BotTradesPanel({ bot, selected, onSelect }: BotTradesPanelProps) {
  const settings = usePoll(() => api.settings(), POLL_MS);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<BookView>("all");
  // The terminal sets each open spread as a card; the broadsheet keeps the table.
  const minimal = useTemplate() === "minimal";

  const b = bot.data;
  const tpPct = settings.data?.tp_pct ?? 50;
  const slMultiple = settings.data?.sl_multiple ?? 2;

  // The segmented control only filters; it never merges the two books into one list, which would
  // have to invent an exit price the open spreads do not have yet.
  const showOpen = view !== "closed";
  const showClosed = view !== "open";

  // Exit levels and open spreads both move when settings are saved elsewhere.
  useEffect(
    () =>
      onSettingsSaved(() => {
        void bot.refresh();
        void settings.refresh();
      }),
    [bot.refresh, settings.refresh],
  );

  async function closeAll() {
    setConfirming(false);
    try {
      const r = await api.closeAllBot();
      setMessage(`Closing ${r.closing} bot ${r.closing === 1 ? "position" : "positions"}`);
      toast(`Closing ${r.closing} bot ${r.closing === 1 ? "position" : "positions"}`);
      await bot.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel
      title="Bot trades"
      actions={
        minimal && b ? (
          <div className="flex items-center gap-3">
            {/* The panel holds two books in one frame, so the head names how much is in each
                rather than leaving you to count the rows. */}
            <span className="chip">
              {b.active.length} live · {b.closed.length} closed
            </span>
            <div className="flex">
              {VIEWS.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`seg border px-2.5 py-1 text-xs transition-colors ${
                    i > 0 ? "-ml-px" : ""
                  } ${
                    view === v.id
                      ? "border-ink bg-ink text-sheet"
                      : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        ) : undefined
      }
    >
      {bot.error && !b && <p className="text-sm text-critical">{bot.error}</p>}
      {b && (
        <div className="flex flex-col gap-4 text-sm">
          {showOpen && b.active.length === 0 && minimal && (
            <p className="text-sm text-ink-2">No bot spreads open.</p>
          )}
          {showOpen && minimal && b.active.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
              {b.active.map((t) => (
                <BotPositionCard
                  key={t.id}
                  trade={t}
                  mark={b.marks[t.id]}
                  tpPct={tpPct}
                  inspecting={selected === t.id}
                  onInspect={() => onSelect(selected === t.id ? null : t.id)}
                />
              ))}
            </ul>
          )}
          {!minimal && showOpen && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left">
                <th className={TH}>Ticker</th><th className={TH}>Spread</th><th className={TH}>State</th>
                <th className={TH}>Credit</th><th className={TH}>Cost to close</th><th className={TH}>Exits</th>
                <th className={TH}>AI checked</th>
              </tr>
            </thead>
            <tbody>
              {b.active.length === 0 && (
                <tr><td colSpan={7} className={`${TD} text-ink-2`}>No bot spreads open.</td></tr>
              )}
              {b.active.map((t) => {
                const levels = exitLevels(t, tpPct, slMultiple);
                const mark = b.marks[t.id];
                return (
                  <tr key={t.id}>
                    {/* The ticker opens the payoff panel below, the same way the ticker does on the
                        paper book's table: the terminal's card carries this as an explicit inspect
                        button, and a table has no room for one button per row. */}
                    <th scope="row" className={`${TD} text-left`}>
                      <button
                        type="button"
                        aria-pressed={selected === t.id}
                        onClick={() => onSelect(selected === t.id ? null : t.id)}
                        className={`font-display text-base font-semibold text-ink ${
                          selected === t.id ? "underline" : ""
                        }`}
                      >
                        {t.ticker}
                      </button>
                    </th>
                    <td className={TD}>{spreadLabel(t.direction)} {t.short_strike}/{t.long_strike}</td>
                    <td className={`${TD} text-ink-2`}>{t.state}</td>
                    <td className={`${TD} num`}>{t.credit === null ? "—" : `$${t.credit.toFixed(2)}`}</td>
                    <td className={`${TD} num`}>{mark === undefined ? "—" : `$${mark.toFixed(2)}`}</td>
                    <td className={`${TD} num text-ink-2`}>{levels ? `TP $${levels.tp.toFixed(2)} · SL $${levels.sl.toFixed(2)}` : "—"}</td>
                    <td className={`${TD} text-ink-2`}>{formatTime(t.last_ai_check)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}

          {/* Only one button may close the book at a time, and in the terminal that is the
              emergency exit on the controller: closing is the bot's whole job, so it belongs with
              the rest of the bot's controls rather than inside the list of what it holds. */}
          {!minimal && (
            <div className="flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <button type="button" onClick={closeAll} className={BTN_DANGER}>
                    Yes, close all at market
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={BTN}>
                    Keep them
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={BTN_DANGER}>
                  Close all bot positions
                </button>
              )}
              {message && <span className="text-ink-2">{message}</span>}
            </div>
          )}

          {showClosed && minimal && b.closed.length === 0 && (
            <p className="text-sm text-ink-2">The bot has not closed a spread yet.</p>
          )}
          {showClosed && minimal && b.closed.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
              {b.closed.map((t) => (
                <ClosedBotCard key={t.id} trade={t} />
              ))}
            </ul>
          )}
          {showClosed && !minimal && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className={TH}>Closed</th><th className={TH}>Ticker</th><th className={TH}>Exit</th><th className={TH}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {b.closed.map((t) => (
                  <tr key={t.id}>
                    <td className={`${TD} text-ink-2`}>{formatTime(t.closed_at)}</td>
                    <td className={`${TD} font-display text-base font-semibold text-ink`}>{t.ticker}</td>
                    <td className={TD}>{t.exit_reason ? EXIT_LABEL[t.exit_reason] : "—"}</td>
                    <td className={`${TD} num ${t.pnl !== null && t.pnl < 0 ? "text-loss" : "text-profit"}`}>{formatMoney(t.pnl, { signed: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* The terminal sets the log out in the cockpit's rail instead, beside the control that
              stops the orders; the broadsheet keeps it folded away under the table. */}
          {!minimal && (
            <details>
              <summary className="eyebrow cursor-pointer">Order log ({b.events.length})</summary>
              <ul className="log mt-3 max-h-72 space-y-1 overflow-y-auto">
                {b.events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-ink-2">{formatTime(e.ts)}</span>
                    <span className="text-ink">{e.action}</span>
                    <span className="text-ink-2">{e.status}</span>
                    {e.price !== null && <span>${e.price.toFixed(2)}</span>}
                    {e.reason && <span className="truncate text-ink-2" title={e.reason}>{e.reason}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * One spread the bot has already closed, on the card the open ones are set on.
 *
 * A closed spread has no mark and no exit to work towards, so it gives up the greeks and the
 * progress meter and carries the two prices the trade actually went through at instead: what it
 * was sold for, and what it was bought back for. The debit is the broker's dealt average, the same
 * figure the engine booked its P&L against.
 */
function ClosedBotCard({ trade }: { trade: LiveTrade }) {
  const pnl = trade.pnl;
  return (
    <li className={`pos-card ${spineClass(trade.direction)} flex min-w-0 flex-col gap-3 border border-rule`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold text-ink">{trade.ticker}</span>
        <span className="eyebrow">{spreadLabel(trade.direction)} spread</span>
        <span className="num ml-auto text-xs text-ink-2">{formatTime(trade.closed_at)}</span>
      </div>

      <p className="text-sm text-ink-2">
        {formatStrike(trade.short_strike)} / {formatStrike(trade.long_strike)} · Exp{" "}
        {formatDate(trade.expiry)}
      </p>

      <dl className="pos-strip grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Metric label="Contracts" value={String(trade.contracts)} />
        <Metric label="Sold at" value={formatStrike(trade.credit)} />
        <Metric label="Bought back" value={formatStrike(trade.close_debit)} />
        <Metric label="Fees" value={formatMoney(trade.fees, { signed: false })} />
        <Metric label="Exit" value={trade.exit_reason ? EXIT_LABEL[trade.exit_reason] : "—"} />
        <Metric
          label="Realised P&L"
          value={formatMoney(pnl, { signed: true })}
          tone={pnl === null ? "muted" : pnl < 0 ? "loss" : "profit"}
        />
      </dl>
    </li>
  );
}
