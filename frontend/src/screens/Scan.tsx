import { useEffect, useState } from "react";
import { GateFunnel } from "../components/GateFunnel";
import { GateMatrix } from "../components/GateMatrix";
import { GateTrack, GateTrackHeader } from "../components/GateTrack";
import { Panel } from "../components/Panel";
import { QuickInspect } from "../components/QuickInspect";
import { StatusBadge } from "../components/StatusBadge";
import { api, type JournalRow, type Settings } from "../lib/api";
import { engineState } from "../lib/engineState";
import { funnel } from "../lib/funnel";
import { hrefFor, useRoute } from "../lib/route";
import {
  asStage,
  confidenceText,
  cycleSummary,
  expiryChip,
  filterByStage,
  filterScanRows,
  gateCells,
  outcomeBadge,
  rowStatus,
  scanFilters,
  strategyLabel,
  tradeFacts,
  whyParts,
  whyText,
  type FilterKey,
} from "../lib/scan";
import { useTemplate } from "../lib/templates";
import { formatTime } from "../lib/time";
import { usePoll } from "../lib/usePoll";
import { isEngineBusy, scanNowView } from "../lib/scanNow";
import { GATES, outcome, sortScanRows } from "../lib/views";
import { toast } from "../lib/toast";
import { BTN, BTN_DANGER, BTN_SOLID } from "../lib/ui";

const POLL_MS = 30000;
const BUSY_POLL_MS = 5000; // while a cycle runs, rows fill in as each ticker finishes
const STATUS_POLL_MS = 15000;
const SETTINGS_POLL_MS = 60000; // the watchlist only moves when someone edits Settings
// A scan does not report itself the moment it is asked for, so the status polls fast for a
// while after the button: the chip and the sweep should come up with the cycle, not after it.
const SCAN_BOOST_MS = 20000;
// A confirm left open goes stale: it offers to drop rows the person may no longer mean.
const CONFIRM_MS = 5000;

export function Scan() {
  const [boost, setBoost] = useState(false);
  const [fast, setFast] = useState(false);
  const status = usePoll(() => api.engineStatus(), fast || boost ? BUSY_POLL_MS : STATUS_POLL_MS);
  const busy = isEngineBusy(status.data?.state);
  const scan = usePoll(() => api.scanLatest(), busy ? BUSY_POLL_MS : POLL_MS);
  const journal = usePoll(() => api.journal(40), busy ? BUSY_POLL_MS : POLL_MS);
  const settings = usePoll(() => api.settings(), SETTINGS_POLL_MS);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => setFast(busy), [busy]);

  useEffect(() => {
    if (!boost) return;
    const t = setTimeout(() => setBoost(false), SCAN_BOOST_MS);
    return () => clearTimeout(t);
  }, [boost]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  const rows = sortScanRows(scan.data ?? []);
  // The funnel's gate rows link in carrying the gate they turned you away at. It narrows the board
  // on top of the outcome filter rather than replacing it, and it lives in the URL — so the link
  // is the whole of the state and there is nothing to fall out of step with it.
  const stopped = asStage(useRoute().params.stopped);
  const shown = filterByStage(filterScanRows(rows, filter), stopped);
  const filters = scanFilters(rows);
  const updated = rows.reduce<string | null>((m, r) => (m === null || r.ts > m ? r.ts : m), null);
  const recent = journal.data ?? [];
  // Minimal reads a row in place: the rail follows whichever one is picked, and falls back to
  // the top of the board so it is never empty while there is something to show.
  const inspected = shown.find((r) => r.id === picked) ?? shown[0] ?? null;
  const minimal = useTemplate() === "minimal";
  const view = scanNowView(status.data, starting);

  const clear = async () => {
    setClearing(true);
    try {
      const { cleared } = await api.clearScan();
      toast(`Cleared ${cleared} scan ${cleared === 1 ? "row" : "rows"}`);
      setConfirming(false);
      setClearError(null);
      await Promise.all([scan.refresh(), journal.refresh()]);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const runScan = async () => {
    if (view.disabled) return;
    setStarting(true);
    setScanError(null);
    try {
      await api.scanNow();
      toast("Scan started");
      setBoost(true);
      await Promise.all([status.refresh(), scan.refresh(), journal.refresh()]);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  // Both controls belong to the board wherever the board's controls sit: Minimal carries them
  // in the cycle panel above it, the desk keeps them on the board's own head.
  const startControl = (
    <span className="flex items-center gap-2">
      <button type="button" onClick={runScan} disabled={view.disabled} className={BTN_SOLID}>
        {view.label}
      </button>
      {scanError && <StatusBadge tone="critical" label={scanError} />}
    </span>
  );

  const clearControl = rows.length > 0 && (
    <span className="flex items-center gap-2">
      {confirming ? (
        <>
          <button type="button" onClick={clear} disabled={clearing} className={BTN_DANGER}>
            Confirm clear
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={clearing} className={BTN}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={BTN}>
          Clear
        </button>
      )}
      {clearError && <StatusBadge tone="critical" label={clearError} />}
    </span>
  );

  return (
    // Minimal keeps the rail beside the board, so a row can be read without leaving the list.
    <div
      className={`flex flex-col gap-6 ${
        minimal ? "min-[1200px]:flex-row min-[1200px]:items-start" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {rows.length > 0 && (
          <>
            <Panel
              title="Engine scan cycle"
              actions={<EngineChip state={status.data?.state} />}
              className={busy ? "scan-wash" : ""}
            >
              <div className="flex flex-col gap-4">
                {/* The terminal folds the board's filter row and scan controls into this panel, so
                    this is the only place it shows them. Broadsheet keeps both on the Scan panel
                    below — carrying them here too would print the same controls twice. */}
                {minimal && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    {filters.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={filter === f.key}
                        onClick={() => setFilter(f.key)}
                        className={`pill flex items-baseline gap-1.5 transition-colors ${
                          filter === f.key ? "font-semibold" : "text-ink-2 hover:bg-well hover:text-ink"
                        }`}
                      >
                        {f.label}
                        <span className={filter === f.key ? "opacity-70" : "text-ink-2"}>{f.count}</span>
                      </button>
                    ))}
                    <span className="ml-auto flex items-center gap-2">
                      {startControl}
                      {clearControl}
                    </span>
                  </div>
                )}
                <CycleSummary rows={rows} settings={settings.data} />
                <CycleStrip state={status.data?.state} />
              </div>
            </Panel>
            <Panel
              title="Pipeline"
              actions={<span className="eyebrow">Six gates, in the order they run</span>}
            >
              <GateFunnel gates={funnel(rows)} />
            </Panel>
          </>
        )}
        <Panel
          title="Scan"
          actions={
            <div className="flex items-center gap-2">
              {updated && <span className="eyebrow">Updated {formatTime(updated)}</span>}
              {/* Minimal carries the scan control in the cycle panel above it, and that panel only
                  exists once the board has rows — so on an empty board the head takes it back. */}
              {(!minimal || rows.length === 0) && startControl}
              {!minimal && clearControl}
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-ink-2">
              No scans yet. Press Scan now above, or turn the engine on to scan on a schedule. To
              check a single ticker,{" "}
              <a className="text-profit underline" href={hrefFor("study")}>
                open Study
              </a>
              .
            </p>
          ) : (
            <>
              {stopped && (
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
                  <span className="eyebrow">Stopped at</span>
                  <a
                    href={hrefFor("scan")}
                    className="pill flex items-baseline gap-1.5"
                    title="Clear this filter"
                  >
                    {GATES.find((g) => g.stage === stopped)?.label ?? "Alert sent"}
                    <span aria-hidden="true">×</span>
                  </a>
                  <span className="text-xs text-ink-2">
                    {shown.length} of {rows.length} on the board
                  </span>
                </div>
              )}
              {!minimal && (
                <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule">
                  {filters.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={filter === f.key}
                      onClick={() => setFilter(f.key)}
                      className={`eyebrow -mb-px flex items-baseline gap-1.5 border-b-2 px-0.5 pb-1.5 transition-colors ${
                        filter === f.key
                          ? "border-ink text-ink"
                          : "border-transparent hover:border-rule-strong"
                      }`}
                    >
                      {f.label} <span className="text-ink-2">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}

              {shown.length === 0 && (
                <p className="text-sm text-ink-2">
                  Nothing on the board stopped at this gate. The board keeps the latest row for each
                  ticker, so an earlier scan may have stopped here and been replaced since.
                </p>
              )}

              {minimal ? (
                <ul className="flex flex-col gap-2">
                  {shown.map((r) => (
                    <ScanCard
                      key={r.id}
                      row={r}
                      selected={inspected?.id === r.id}
                      onSelect={() => setPicked(r.id)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-16" />
                      <col className="w-10" />
                      <col className="w-[262px]" />
                      <col />
                      <col className="w-36" />
                    </colgroup>
                    <thead className="hidden min-[900px]:table-header-group">
                      <tr className="text-left">
                        <th className="pb-1.5 pr-2">Ticker</th>
                        <th className="pb-1.5 pr-2 text-right">DTE</th>
                        <th className="pb-1.5 pr-2">
                          <GateTrackHeader />
                        </th>
                        <th className="pb-1.5 pr-2">Why</th>
                        <th className="pb-1.5">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <ScanRow key={r.id} row={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-3 eyebrow">
                Gates in order: {GATES.map((g) => g.label).join(", ")}.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* The journal is for watching a cycle as it runs, so Minimal puts it beside the board with
          the inspect panel rather than four screens below it. Broadsheet has no journal — its
          Recent decisions panel is the same list — so the column only ever holds two there.
          The rail's width is the terminal's: the desk stacks this column under the board, and a
          fixed width would leave the list scrolling inside a 18rem slot with the page empty
          beside it. */}
      <div
        className={`flex flex-col gap-6 ${
          minimal ? "min-[1200px]:w-80 min-[1200px]:shrink-0" : ""
        }`}
      >
        <Panel title={minimal ? "Setup quick-inspect" : "Recent decisions"}>
          {minimal ? (
            inspected ? (
              <QuickInspect
                row={inspected}
                onOpen={() => {
                  window.location.hash = hrefFor("study", {
                    ticker: inspected.decision.ticker,
                    dte: inspected.decision.dte,
                  });
                }}
              />
            ) : (
              <p className="text-sm text-ink-2">Nothing to inspect yet.</p>
            )
          ) : recent.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing yet.</p>
          ) : (
            <JournalList rows={recent} />
          )}
        </Panel>

        {minimal && (
          <Panel
            title="Engine journal"
            actions={<span className="eyebrow">Last {recent.length} decisions</span>}
          >
            <JournalList rows={recent} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** One decision in the Minimal feed: the trade it found, then what the gates did with it. */
function ScanCard({
  row,
  selected,
  onSelect,
}: {
  row: JournalRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const d = row.decision;
  const status = rowStatus(d);
  const facts = tradeFacts(d);
  const strategy = strategyLabel(d);
  // A priced row shows what every gate read; anything that stopped also says why.

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="scan-card flex w-full flex-col gap-2.5 border border-rule text-left transition-colors hover:border-rule-strong"
      >
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span aria-hidden="true" className={`track-dot track-dot-${outcome(d)}`} />
          <span className="font-display text-[17px] font-semibold text-ink">{d.ticker}</span>
          <span className="chip">{expiryChip(d)}</span>
          {strategy && <span className="chip text-accent">{strategy.toUpperCase()}</span>}
          <span className="ml-auto flex items-center gap-2.5">
            {facts.strikes && (
              <span className="whitespace-nowrap text-xs text-ink-2">
                Strike spread <span className="tabular-nums text-ink">{facts.strikes}</span>
              </span>
            )}
            <StatusBadge tone={status.tone} label={status.label} />
          </span>
        </span>

        {facts.credit && (
          <span className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {facts.delta && <Fact label="Delta" value={`${facts.delta} Δ`} />}
            <Fact label="Premium" value={`${facts.credit} Cr`} />
            {facts.maxLoss && <Fact label="Max risk" value={facts.maxLoss} />}
            {facts.pop && <Fact label="Prob. of profit" value={`${facts.pop} POP`} />}
            <Fact label="Logged" value={formatTime(row.ts)} />
          </span>
        )}

        {facts.credit ? (
          <GateMatrix cells={gateCells(d)} />
        ) : (
          <span className={`reject-note reject-note-${outcome(d)} flex flex-col gap-0.5`}>
            <span className="eyebrow">{outcome(d) === "error" ? "Error" : "Rejection reason"}</span>
            <span className="text-xs text-ink">{whyText(d)}</span>
          </span>
        )}

        {facts.credit && outcome(d) !== "alert" && (
          <span className={`reject-note reject-note-${outcome(d)} flex flex-col gap-0.5`}>
            <span className="eyebrow">{outcome(d) === "error" ? "Error" : "Rejection reason"}</span>
            <span className="line-clamp-3 text-xs text-ink" title={whyText(d)}>
              {whyText(d)}
            </span>
          </span>
        )}

        {confidenceText(d) && <span className="eyebrow">{confidenceText(d)}</span>}
      </button>
    </li>
  );
}

/** One reading in a row's facts line: the label above it, the number set against it. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </span>
  );
}

/**
 * The engine's state, with a dot that ripples only while a cycle is actually running.
 */
function EngineChip({ state }: { state: string | null | undefined }) {
  const live = isEngineBusy(state);
  const { tone, label } = engineState(state);

  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={`scan-dot scan-dot-${tone}${live ? " scan-dot-live" : ""}`} />
      <span className="eyebrow text-[11px] text-ink">{label}</span>
    </span>
  );
}

/**
 * What the engine is doing this second. The sweep is indeterminate: the engine counts no
 * percentage of a cycle, so this shows that one is running and never how far along it is.
 */
function CycleStrip({ state }: { state: string | null | undefined }) {
  if (!isEngineBusy(state)) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <span aria-hidden="true" className="scan-sweep block h-0.5 w-full" />
      <span className="text-xs text-ink-2">
        {state === "scanning"
          ? "Scanning the watchlist — a row lands as each ticker finishes."
          : "Building the edge table — this one takes a while."}
      </span>
    </div>
  );
}

/**
 * Where the cycle stands: how many tickers the board holds, what the engine is watching, and how
 * many rows came through every gate. Every figure is counted off the board or read from Settings —
 * the mockup's cycle number, scan rate and "setups evaluated" tiles have nothing behind them, so
 * they are left out.
 */
function CycleSummary({ rows, settings }: { rows: JournalRow[]; settings: Settings | null }) {
  const { logged, watchlist, dtes, cleared } = cycleSummary(rows, settings);

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <span className="flex items-baseline gap-2.5">
        <span className="font-display text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
          {logged.toLocaleString()}
        </span>
        <span className="eyebrow">tickers logged</span>
      </span>
      <CycleStat label="Watchlist" value={settings ? `${watchlist} tickers` : "—"} />
      <CycleStat
        label="Expiries"
        value={
          settings
            ? dtes.length === 0
              ? "none set"
              : `${dtes.length} DTE${dtes.length === 1 ? "" : "s"} (${dtes.join("d, ")}d)`
            : "—"
        }
      />
      <CycleStat label="Cleared all six gates" value={String(cleared)} tone={cleared > 0} />
    </div>
  );
}

function CycleStat({ label, value, tone = false }: { label: string; value: string; tone?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className={`font-display text-xl font-semibold tabular-nums ${tone ? "text-profit" : "text-ink"}`}>
        {value}
      </span>
    </span>
  );
}

/** Every decision the engine logged, newest first: what it looked at and what came of it. */
function JournalList({ rows }: { rows: JournalRow[] }) {
  return (
    <ul className="max-h-96 overflow-y-auto">
      {rows.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2 border-b border-rule py-1.5 text-sm last:border-0">
          <span className="eyebrow w-16 shrink-0">{formatTime(r.ts)}</span>
          <span className="font-display text-base font-semibold text-ink">{r.decision.ticker}</span>
          <span className="text-ink-2">{r.decision.dte}d</span>
          <span className="ml-auto text-xs text-ink-2">{outcomeBadge(r.decision).label}</span>
        </li>
      ))}
    </ul>
  );
}

function ScanRow({ row }: { row: JournalRow }) {
  const d = row.decision;
  const { value, note } = whyParts(d);
  const full = whyText(d);
  const confidence = confidenceText(d);
  const undelivered = outcome(d) === "alert" && d.alert_sent === false;
  const open = () => {
    window.location.hash = hrefFor("study", { ticker: d.ticker, dte: d.dte });
  };

  return (
    <tr
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      className="cursor-pointer"
    >
      <td className="py-2 pr-2 font-display text-base font-semibold text-ink">{d.ticker}</td>
      <td className="num py-2 pr-2 text-ink-2">{d.dte}</td>
      <td className="py-2 pr-2">
        <GateTrack decision={d} />
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-baseline gap-3">
          <span className="w-24 shrink-0 whitespace-nowrap text-right tabular-nums text-ink">{value ?? "—"}</span>
          <span className="truncate text-ink-2" title={full}>
            {note}
          </span>
          {confidence && <span className="ml-auto shrink-0 whitespace-nowrap eyebrow">{confidence}</span>}
          {undelivered && <StatusBadge tone="warn" label="Alert not delivered" />}
        </div>
      </td>
      <td className="whitespace-nowrap py-2 text-ink-2">{formatTime(row.ts)}</td>
    </tr>
  );
}