import { Suspense, lazy, useEffect, useState } from "react";
import { BotTradesPanel } from "../components/BotTradesPanel";
import { BotIcon } from "../components/Icons";
import { Metric, TONE } from "../components/Metric";
import { OrderLogPanel } from "../components/OrderLogPanel";
import { Panel } from "../components/Panel";
import { SpreadCard } from "../components/SpreadCard";
import { StatusBadge, type Tone } from "../components/StatusBadge";
import { api, type BotStatus, type OpenPosition, type Position } from "../lib/api";
import { bookLabel, bookWord } from "../lib/account";
import { botBadge } from "../lib/bot";
import { countdown, exposure, settlement, type Exposure } from "../lib/manage";
import { onSettingsSaved } from "../lib/settingsBus";
import { useTemplate } from "../lib/templates";
import { formatDate } from "../lib/time";
import { usePoll } from "../lib/usePoll";
import { formatMoney, formatPct, riskMeter, spreadLabel } from "../lib/views";
import { toast } from "../lib/toast";
import { BTN, BTN_DANGER } from "../lib/ui";

// Pulls in three.js, so it stays out of the bundle until a row is selected.
const PayoffSurfacePanel = lazy(() =>
  import("../components/PayoffSurfacePanel").then((m) => ({ default: m.PayoffSurfacePanel })),
);

const POLL_MS = 60000;
// The live book moves with the option it holds, so it is read on the trade table's cadence rather
// than the paper book's. Both panels above and below share this one poll.
const LIVE_POLL_MS = 15000;
const CONFIRM_MS = 5000;

const ACTION_BUTTON = `whitespace-nowrap ${BTN}`;
const CONFIRM_BUTTON = `whitespace-nowrap ${BTN_DANGER}`;
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

/**
 * The live book as tiles, each carrying the reading that qualifies its figure.
 *
 * Six of the nine rows Minimal used to rule off are the same reading twice: open spreads is the
 * count under credit deployed, wins / losses is the pair under win rate, credit captured is what
 * the unrealised P&L is earned against. Realised P&L has no second reading to sit under, so it
 * keeps a tile of its own rather than being dropped for being the odd one out.
 */
function ExposureTiles({ totals }: { totals: Exposure }) {
  // In the terminal this panel is one column of the cockpit rather than the width of the page, so
  // the five tiles wrap onto a second row instead of being squeezed to fit one. The breakpoints
  // are the viewport's, which is why the rail can be beside them at all.
  const minimal = useTemplate() === "minimal";
  return (
    <dl
      className={`mt-5 grid grid-cols-2 gap-3 min-[900px]:grid-cols-3 ${
        minimal ? "" : "min-[1300px]:grid-cols-5"
      }`}
    >
      <StatTile
        label="Credit deployed"
        value={formatMoney(totals.credit, { signed: false })}
        sub={`${totals.count} active ${totals.count === 1 ? "contract" : "contracts"}`}
      />
      <StatTile
        label="Margin committed"
        value={formatMoney(totals.margin, { signed: false })}
        sub={`NAV usage ${formatPct(totals.navPct)}`}
      />
      <StatTile
        label="Unrealised P&L"
        value={formatMoney(totals.unrealized, { signed: true })}
        tone={totals.unrealized > 0 ? "profit" : totals.unrealized < 0 ? "loss" : "muted"}
        sub={`${formatPct(totals.capturedPct)} of credit captured`}
      />
      <StatTile
        label="Realised P&L"
        value={formatMoney(totals.realized, { signed: true })}
        tone={totals.realized > 0 ? "profit" : totals.realized < 0 ? "loss" : "muted"}
        sub={`${totals.wins + totals.losses} closed`}
      />
      <StatTile
        label="Win rate"
        value={formatPct(totals.winRate * 100)}
        sub={`${totals.wins} / ${totals.losses} closed`}
      />
    </dl>
  );
}

/** A figure with its label above and the reading that explains it below. */
function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="stat-card flex min-w-0 flex-col">
      <dt className="eyebrow">{label}</dt>
      <dd className={`figure mt-0.5 truncate ${tone ? TONE[tone] : "text-ink"}`}>{value}</dd>
      <dd className="stat-sub mt-0.5">{sub}</dd>
    </div>
  );
}

/**
 * What the bot is doing right now, read off the same status the header badge polls.
 *
 * The mockup drew this panel as a row of switches for the daemons behind the bot — OpenD, the AI
 * guard, the settle rule, the loop. The app has no such switches: those are one background thread
 * with no sub-controls, and OpenD is a process the app talks to rather than owns. So this reads
 * their state instead of pretending to set it.
 *
 * One control is left, and it is the one that cannot be reached from anywhere else on a phone:
 * closing the book. Stopping and resuming entries is not repeated here because the folio line
 * carries it on every screen already, and two buttons for one action is one too many.
 */
function ExecutionController({ bot, onRefresh }: { bot: BotStatus; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The confirm disarms itself: a destructive button left armed is one you can hit by coming back
  // to the window, and the book it closes is real.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  async function exitAll() {
    setConfirming(false);
    try {
      const r = await api.closeAllBot();
      const msg = `Closing ${r.closing} ${r.closing === 1 ? "position" : "positions"}`;
      setMessage(msg);
      toast(msg);
      onRefresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <BotIcon />
          Execution controller
        </span>
      }
      actions={<StatusBadge {...botBadge(bot)} />}
    >
      <dl className="flex flex-col">
        <ControllerRow
          label="Entries"
          value={bot.paused ? "Paused" : "Live"}
          sub={bot.paused ? bot.pause_reason : "taking new spreads"}
        />
        <ControllerRow
          label="Mode"
          value={bot.mode}
          sub={bot.mode === "auto" ? "opened by the engine" : "entries placed by you"}
        />
        <ControllerRow
          label="Monitor"
          value={bot.monitor.state}
          sub={bot.monitor.last_error ?? "no errors"}
        />
        <ControllerRow
          label="Slots"
          value={`${bot.active.length} of ${bot.slots}`}
          sub={`next slot at ${formatMoney(bot.next_slot_at, { signed: false })}`}
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        {confirming ? (
          <>
            <button type="button" onClick={exitAll} className={`flex-1 justify-center ${BTN_DANGER}`}>
              Yes, close all at market
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`flex-1 justify-center ${BTN}`}
            >
              Keep them
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`flex-1 justify-center ${BTN_DANGER}`}
          >
            Emergency exit
          </button>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-ink-2">{message}</p>}
    </Panel>
  );
}

/** One reading on the controller: what is being reported, then the figure and the note under it. */
function ControllerRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="flex min-w-0 flex-col items-end">
        <span className="num text-sm text-ink">{value}</span>
        <span className="stat-sub max-w-full truncate">{sub}</span>
      </dd>
    </div>
  );
}

function ClosedRow({ trade }: { trade: Position }) {
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

/**
 * One open paper position, on the same card the live book uses.
 *
 * The paper book marks to model exactly as the live one does -- P&L is the credit less what it
 * costs to buy back -- so the cost to close is that P&L divided back out. The pricer behind it is
 * the same one, which is what makes the greeks on both cards comparable.
 */
function PositionCard({
  p,
  tpPct,
  selected,
  onSelect,
  confirming,
  onConfirm,
  onKeep,
  onClose,
}: {
  p: OpenPosition;
  tpPct: number;
  selected: boolean;
  onSelect: () => void;
  confirming: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const mark = p.mtm_pnl === null ? undefined : p.credit - p.mtm_pnl / (100 * p.contracts);

  return (
    <SpreadCard
      ticker={p.ticker}
      direction={p.direction}
      shortStrike={p.short_strike}
      longStrike={p.long_strike}
      contracts={p.contracts}
      expiry={p.expiry}
      credit={p.credit}
      mark={mark}
      enteredAt={p.entry_date}
      tpPct={tpPct}
      badges={flags(p)}
      status={`Paper trade, ${p.mode} — no order is resting.`}
      actions={
        confirming ? (
          <>
            <button type="button" onClick={onClose} className={CONFIRM_BUTTON}>
              Confirm close at current price
            </button>
            <button type="button" onClick={onKeep} className={ACTION_BUTTON}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={selected}
              onClick={onSelect}
              className={`whitespace-nowrap ${
                selected ? "border-accent text-ink" : "border-rule text-ink-2"
              } border px-3 py-1.5 text-sm`}
            >
              Inspect 3D payoff
            </button>
            <button type="button" onClick={onConfirm} className={ACTION_BUTTON}>
              Close position
            </button>
          </>
        )
      }
    />
  );
}

function ClosedCard({ trade }: { trade: Position }) {
  const pnl = trade.close_pnl;
  return (
    <li className="pos-card flex min-w-0 flex-col gap-2 border border-rule">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold text-ink">{trade.ticker}</span>
        <span className="text-sm text-ink-2">
          {spreadLabel(trade.direction)} {formatMoney(trade.short_strike, { signed: false })}/
          {formatMoney(trade.long_strike, { signed: false })}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Metric label="Contracts" value={String(trade.contracts)} />
        <Metric label="Entry" value={formatDate(trade.entry_date)} />
        <Metric label="Closed" value={formatDate(trade.close_date)} />
        <Metric
          label="Realised P&L"
          value={formatMoney(pnl, { signed: true })}
          tone={pnl === null ? "muted" : pnl < 0 ? "loss" : "profit"}
        />
        <Metric label="Mode" value={trade.mode} />
      </dl>
    </li>
  );
}

function flags(p: OpenPosition): { tone: Tone; label: string }[] {
  const out: { tone: Tone; label: string }[] = [];
  if (p.profit_take_hit) out.push({ tone: "good", label: "Take profit (50% reached)" });
  if (p.short_breached) out.push({ tone: "critical", label: "Short strike breached" });
  if (p.days_left <= 2) {
    out.push({ tone: "warn", label: `Expires in ${p.days_left} ${p.days_left === 1 ? "day" : "days"}` });
  }
  if (p.spot === null) out.push({ tone: "neutral", label: "No quote" });
  return out;
}

/**
 * The wait until the next forced close, ticking on its own so the position tables below are not
 * re-rendered once a second to move one line of text.
 */
function SettlementClock({ at }: { at: Date | null }) {
  const target = at?.getTime() ?? null;
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (target === null) return;
    const tick = () => setMsLeft(target - Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);

  return <span className="num">{countdown(msLeft)}</span>;
}

function Placeholder({ label }: { label: string }) {
  return (
    <section className="border border-rule-strong bg-well p-4 text-sm text-ink-2">
      {label}
    </section>
  );
}