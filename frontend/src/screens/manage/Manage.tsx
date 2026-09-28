import { Suspense, lazy, useEffect, useState } from "react";
import { BotTradesPanel } from "@/components/manage/BotTradesPanel";
import { Metric } from "@/components/shared/Metric";
import { OrderLogPanel } from "@/components/manage/OrderLogPanel";
import { Panel } from "@/components/shared/Panel";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { api, type OpenPosition } from "@/lib/infra/api";
import { bookLabel, bookWord } from "@/lib/domain/account";
import { exposure, settlement } from "@/lib/domain/manage";
import { onSettingsSaved } from "@/lib/infra/settingsBus";
import { useTemplate } from "@/lib/infra/templates";
import { formatDate } from "@/lib/infra/time";
import { usePoll } from "@/lib/hooks/usePoll";
import { formatMoney, formatPct, riskMeter, spreadLabel } from "@/lib/domain/views";
import { toast } from "@/lib/infra/toast";
import { ACTION_BUTTON, CONFIRM_BUTTON, CONFIRM_MS } from "./parts/constants";
import { ClosedCard, PositionCard, flags, SettlementClock } from "./parts/PositionCard";
import { ClosedRow } from "./parts/ClosedRow";
import { ExecutionController } from "./parts/ExecutionController";
import { ExposureTiles } from "./parts/ExposureTiles";
import { Placeholder } from "./parts/Placeholder";

// Pulls in three.js, so it stays out of the bundle until a row is selected.
const PayoffSurfacePanel = lazy(() =>
  import("@/components/shared/PayoffSurfacePanel").then((m) => ({ default: m.PayoffSurfacePanel })),
);

const POLL_MS = 60000;
// The live book moves with the option it holds, so it is read on the trade table's cadence rather
// than the paper book's. Both panels above and below share this one poll.
const LIVE_POLL_MS = 15000;

const TH = "pb-1.5 pr-3";
const TH_NUM = "num px-2 pb-1.5";
/** The book: every panel of it, set down the left of the cockpit's two columns. */
const BOOK = "flex min-w-0 flex-col gap-8";
/** The bot's controls and its own feed, set in a rail beside the book. */
const RAIL = "flex min-w-0 flex-col gap-8 min-[1200px]:col-start-2 min-[1200px]:row-start-1";

export function Manage() {
  const book = usePoll(() => api.paper(), POLL_MS);
  // The exposure matrix reads the bot's book rather than the hand-recorded one: those are the
  // spreads actually held in the account that is trading, and the only book "margin against NAV"
  // means anything for. The trade table below reads the same poll, so the two cannot report one
  // spread's P&L differently.
  const bot = usePoll(() => api.bot(), LIVE_POLL_MS);
  // Read-only, and the only source of net value. The paper account reports no NAV, so that one
  // tile is blank there for the same reason it is blank while OpenD is down.
  const account = usePoll(() => api.account(), POLL_MS);
  // The paper cards name a take-profit target, which is a settings value rather than the book's.
  const settings = usePoll(() => api.settings(), POLL_MS);
  const accountMode = settings.data?.account_mode;
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  // A confirm left open goes stale: the price it names moves.
  useEffect(() => {
    if (confirming === null) return;
    const t = setTimeout(() => setConfirming(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  // The target every card names is read from settings, so a save elsewhere retargets them.
  useEffect(() => onSettingsSaved(() => void settings.refresh()), [settings.refresh]);

  const stats = book.data?.stats;
  const open = book.data?.open ?? [];
  const closed = [...(book.data?.closed ?? [])].sort((a, b) =>
    (b.close_date ?? "").localeCompare(a.close_date ?? "") || b.id.localeCompare(a.id),
  );
  const meter = riskMeter(stats?.deployed_risk ?? 0, stats?.risk_cap ?? 0);
  const totals = exposure(bot.data, account.data);
  const next = settlement(bot.data?.active ?? []);
  // Minimal sets each position as a card in a grid, and the closed book as a compact list.
  const minimal = useTemplate() === "minimal";
  const tpPct = settings.data?.tp_pct ?? 50;

  // The terminal reads as a cockpit: the book down the left, the bot's own controls in a rail
  // beside it. Broadsheet keeps its single column and sets the same two panels under the book,
  // which is how every other panel on that page is arranged.
  //
  // The two are one column each rather than a panel per grid row: panels sharing a row share its
  // height, so a rail taller than the exposure panel would stretch that row and open a hole under
  // it. Stacked below the wide breakpoint, the book comes first and the bot's rail after it — the
  // stops and starts an operator reaches for are on the folio line above, not down here.
  const cockpit = bot.data;
  const shell =
    cockpit && minimal
      ? "flex flex-col gap-8 min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,1fr)_20rem] min-[1200px]:items-start"
      : "flex flex-col gap-8";

  async function close(position: OpenPosition) {
    setCloseError(null);
    try {
      await api.closePaper(position.id);
      toast(`Closed ${position.ticker} paper trade`);
      setConfirming(null);
      if (selected === position.id) setSelected(null);
      book.refresh();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={shell}>
      <div className={BOOK}>
        <Panel
          title="Portfolio exposure"
          actions={
            minimal && stats ? (
              <span className="chip">
                Risk cap {formatMoney(stats.risk_cap, { signed: false })}
              </span>
            ) : undefined
          }
        >
          {book.error && <p className="text-sm text-critical">{book.error}</p>}
          {!book.data && !book.error && <p className="text-sm text-ink-2">Loading the {bookLabel(accountMode).toLowerCase()}…</p>}
          {bot.error && <p className="mt-1 text-sm text-critical">{bot.error}</p>}
          {!bot.data && !bot.error && <p className="mt-1 text-sm text-ink-2">Loading the live book…</p>}

          {stats && (
            <>
              <p className="eyebrow">
                {formatMoney(stats.deployed_risk, { signed: false })} of{" "}
                {formatMoney(stats.risk_cap, { signed: false })} at risk
              </p>
              <div className="meter-track mt-2 h-2 w-full max-w-md overflow-hidden border border-rule bg-well">
                <span
                  aria-hidden="true"
                  className={`meter-bar block h-full ${meter.over ? "bg-critical" : "bg-accent"}`}
                  style={{ width: `${meter.pct}%` }}
                />
              </div>
              {meter.over && (
                <p className="mt-2">
                  <StatusBadge tone="critical" label="Over the risk cap" />
                </p>
              )}
            </>
          )}

          {totals &&
            (minimal ? (
              <ExposureTiles totals={totals} />
            ) : (
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-4 sm:grid-cols-3">
                <Metric label="Credit deployed" value={formatMoney(totals.credit, { signed: false })} />
                <Metric label="Margin committed" value={formatMoney(totals.margin, { signed: false })} />
                <Metric label="NAV usage" value={formatPct(totals.navPct)} />
                <Metric label="Open spreads" value={String(totals.count)} />
                <Metric
                  label="Unrealised P&L"
                  value={formatMoney(totals.unrealized, { signed: true })}
                  tone={totals.unrealized > 0 ? "profit" : totals.unrealized < 0 ? "loss" : "muted"}
                />
                <Metric label="Credit captured" value={formatPct(totals.capturedPct)} />
                <Metric
                  label="Realised P&L"
                  value={formatMoney(totals.realized, { signed: true })}
                  tone={totals.realized > 0 ? "profit" : totals.realized < 0 ? "loss" : "muted"}
                />
                <Metric label="Win rate" value={formatPct(totals.winRate * 100)} />
                <Metric label="Wins / losses" value={`${totals.wins} / ${totals.losses}`} />
              </dl>
            ))}

          {totals && totals.unmarked > 0 && (
            <p className="mt-2 text-xs text-ink-2">
              {totals.unmarked} of {totals.count} could not be marked, and count as zero above.
            </p>
          )}

          {next.expiry && (
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-rule pt-3 text-sm">
              <StatusBadge
                tone={next.msLeft !== null && next.msLeft <= 0 ? "critical" : "neutral"}
                label={`Expiry ${formatDate(next.expiry)}`}
              />
              <SettlementClock at={next.at} />
              <span className="text-ink-2">
                until the bot force-closes {next.count} {next.count === 1 ? "spread" : "spreads"} at
                3:00 PM New York.
              </span>
            </p>
          )}
        </Panel>


        <BotTradesPanel bot={bot} selected={selected} onSelect={setSelected} />

        <Panel
          title="Open positions"
          actions={
            <span className="chip">
              {minimal ? `${open.length} ${bookWord(accountMode)}` : bookLabel(accountMode)}
            </span>
          }
        >
          {open.length === 0 ? (
            <p className="text-sm text-ink-2">
              No open positions. Record a paper trade from Study to track it here.
            </p>
          ) : minimal ? (
            <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
              {open.map((p) => (
                <PositionCard
                  key={p.id}
                  p={p}
                  tpPct={tpPct}
                  selected={selected === p.id}
                  onSelect={() => setSelected(selected === p.id ? null : p.id)}
                  confirming={confirming === p.id}
                  onConfirm={() => setConfirming(p.id)}
                  onKeep={() => setConfirming(null)}
                  onClose={() => close(p)}
                />
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className={TH}>Ticker</th>
                    <th className={TH}>Spread</th>
                    <th className={TH_NUM}>Contracts</th>
                    <th className={TH_NUM}>Days left</th>
                    <th className={TH_NUM}>Distance to short strike</th>
                    <th className={TH_NUM}>P&L now</th>
                    <th className={TH_NUM}>Share of max profit</th>
                    <th className="px-2 pb-1.5 text-left">Flags</th>
                    <th className={TH_NUM}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className="py-2 pr-3 text-left">
                        <button
                          type="button"
                          aria-pressed={selected === p.id}
                          onClick={() => setSelected(selected === p.id ? null : p.id)}
                          className={`font-display text-base font-semibold text-ink ${
                            selected === p.id ? "underline" : ""
                          }`}
                        >
                          {p.ticker}
                        </button>
                      </th>
                      <td className="py-2 pr-3 text-ink-2">
                        {spreadLabel(p.direction)}{" "}
                        {formatMoney(p.short_strike, { signed: false })}/
                        {formatMoney(p.long_strike, { signed: false })}
                      </td>
                      <td className="num px-2 py-2 text-ink-2">{p.contracts}</td>
                      <td className="num px-2 py-2 text-ink-2">{p.days_left}</td>
                      <td className="num px-2 py-2 text-ink-2">{formatPct(p.distance_pct)}</td>
                      <td
                        className={`num px-2 py-2 ${
                          p.mtm_pnl === null ? "text-ink-2" : p.mtm_pnl < 0 ? "text-loss" : "text-profit"
                        }`}
                      >
                        {formatMoney(p.mtm_pnl, { signed: true })}
                      </td>
                      <td className="num px-2 py-2 text-ink-2">{formatPct(p.profit_pct)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {flags(p).map((f) => (
                            <StatusBadge key={f.label} {...f} />
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {confirming === p.id ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => close(p)}
                              className={CONFIRM_BUTTON}
                            >
                              Confirm close at current price
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirming(null)}
                              className={ACTION_BUTTON}
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirming(p.id)}
                            className={ACTION_BUTTON}
                          >
                            Close position
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {closeError && <p className="mt-3 text-sm text-critical">{closeError}</p>}
        </Panel>

        {selected && (
          <Suspense fallback={<Placeholder label="Loading the payoff surface…" />}>
            {open
              .filter((p) => p.id === selected)
              .map((p) => (
                <PayoffSurfacePanel
                  key={p.id}
                  ticker={p.ticker}
                  direction={p.direction}
                  shortStrike={p.short_strike}
                  longStrike={p.long_strike}
                  credit={p.credit}
                  contracts={p.contracts}
                  expiry={p.expiry}
                />
              ))}
            {/* A bot spread opens the same panel the paper book does: both are one pricer's view of
                a short strike and a long one. A spread with no credit has nothing to price against. */}
            {(bot.data?.active ?? [])
              .filter((t) => t.id === selected)
              .map((t) =>
                t.credit === null ? null : (
                  <PayoffSurfacePanel
                    key={t.id}
                    ticker={t.ticker}
                    direction={t.direction}
                    shortStrike={t.short_strike}
                    longStrike={t.long_strike}
                    credit={t.credit}
                    contracts={t.contracts}
                    expiry={t.expiry}
                  />
                ),
              )}
          </Suspense>
        )}

        <Panel
          title="Closed trades"
          actions={minimal ? <span className="chip">{closed.length} closed</span> : undefined}
        >
          {closed.length === 0 ? (
            <p className="text-sm text-ink-2">No closed trades yet.</p>
          ) : minimal ? (
            <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
              {closed.map((t) => (
                <ClosedCard key={t.id} trade={t} />
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className={TH}>Ticker</th>
                    <th className={TH}>Spread</th>
                    <th className={TH_NUM}>Contracts</th>
                    <th className="px-2 pb-1.5 text-left">Entry</th>
                    <th className="px-2 pb-1.5 text-left">Closed</th>
                    <th className={TH_NUM}>Realised P&L</th>
                    <th className="px-2 pb-1.5 text-left">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((t) => (
                    <ClosedRow key={t.id} trade={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {cockpit && (
        <div className={RAIL}>
          <ExecutionController bot={cockpit} onRefresh={() => void bot.refresh()} />
          {/* The dock runs controls first and telemetry under them, the way the mockup's does. */}
          <OrderLogPanel bot={cockpit} />
        </div>
      )}
    </div>
  );
}

