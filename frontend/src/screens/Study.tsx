import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "../components/Panel";
import { LegCards } from "../components/LegCards";
import { SizeDrawer } from "../components/SizeDrawer";
import { StatusBadge, type Tone } from "../components/StatusBadge";
import { StreamLog } from "../components/StreamLog";
import {
  api,
  type AiVerdict,
  type BacktestStats,
  type BacktestTrade,
  type Signal,
  type SignalMode,
  type StreamLog as LogLine,
} from "../lib/api";
import { DEMO } from "../lib/demo/flag";
import { DemoEventSource } from "../lib/demo/stream";
import { parseStreamEvent } from "../lib/stream";
import { useTemplate } from "../lib/templates";
import { formatDate } from "../lib/time";
import { formatMoney, formatPct, formatStrike, modesAgreeing, parseDte, spreadLabel, studyDtes } from "../lib/views";
import { BTN, INPUT, LABEL } from "../lib/ui";

// Both surfaces pull in three.js, so neither is in the bundle until one is shown.
const IvSurfacePanel = lazy(() =>
  import("../components/IvSurfacePanel").then((m) => ({ default: m.IvSurfacePanel })),
);
const PayoffSurfacePanel = lazy(() =>
  import("../components/PayoffSurfacePanel").then((m) => ({ default: m.PayoffSurfacePanel })),
);

const MODES: { key: SignalMode; label: string }[] = [
  { key: "ivrich", label: "IV rich" },
  { key: "meanrev", label: "Mean reversion" },
  { key: "trend", label: "Trend" },
];


const AI_BADGE: Record<AiVerdict["verdict"], { tone: Tone; label: string }> = {
  CONFIRM: { tone: "good", label: "Confirm" },
  CAUTION: { tone: "warn", label: "Caution" },
  AVOID: { tone: "critical", label: "Avoid" },
};

const RUN_BUTTON = BTN;
const PRIMARY_BUTTON =
  "inline-flex items-center gap-1.5 border border-profit bg-profit px-3 py-1.5 text-sm text-sheet transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50";

type Run = "signal" | "backtest";
type Backtest = { stats: BacktestStats; trades: BacktestTrade[] };

/** What a run is read from: the server's event stream, or the demo desk's playback of one. */
type RunSource = {
  addEventListener(type: string, fn: (ev: Event) => void): void;
  close(): void;
  onerror: ((ev: Event) => void) | null;
};

export function Study({ ticker: tickerParam, dte: dteParam }: { ticker?: string; dte?: string }) {
  const [ticker, setTicker] = useState(() => (tickerParam ?? "").toUpperCase());
  const [dte, setDte] = useState(() => parseDte(dteParam));
  const [savedDtes, setSavedDtes] = useState<number[] | null>(null);
  const [modes, setModes] = useState<SignalMode[]>(["ivrich"]);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [backtest, setBacktest] = useState<Backtest | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [running, setRunning] = useState<Run | null>(null);

  const [ai, setAi] = useState<AiVerdict | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const [sizing, setSizing] = useState(false);
  const sizeButton = useRef<HTMLButtonElement | null>(null);
  // Stable identity: the drawer re-runs its focus/Escape effect when this changes.
  const closeDrawer = useCallback(() => {
    setSizing(false);
    sizeButton.current?.focus();
  }, []);

  const source = useRef<RunSource | null>(null);
  const closeSource = () => {
    source.current?.close();
    source.current = null;
  };
  useEffect(() => closeSource, []);

  // The route can change while this screen is mounted (a row click on Scan), so follow it.
  useEffect(() => {
    if (tickerParam) setTicker(tickerParam.toUpperCase());
  }, [tickerParam]);
  useEffect(() => {
    if (dteParam) setDte(parseDte(dteParam));
  }, [dteParam]);
  // Offer the expiries the engine scans, so a custom one added in Settings can be studied too.
  useEffect(() => {
    let live = true;
    api.settings().then((s) => live && setSavedDtes(s.dtes)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const selected = MODES.filter((m) => modes.includes(m.key)).map((m) => m.key);
  const ready = ticker.trim().length > 0 && selected.length > 0;
  // Minimal tiles the readings and keeps the run in three cards; same run, same numbers.
  const minimal = useTemplate() === "minimal";

  function toggleMode(key: SignalMode) {
    setModes((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  }

  function run(kind: Run) {
    if (!ready || running) return;
    closeSource();
    setLines([]);
    setStreamError(null);
    setRunning(kind);
    if (kind === "signal") {
      setSignal(null);
      setAi(null);
      setAiError(null);
    } else {
      setBacktest(null);
    }

    const url = kind === "signal" ? api.signalStreamUrl(ticker, dte, selected) : api.backtestStreamUrl(ticker, dte, selected);
    // The demo desk plays a run back from its simulated book instead of opening a stream.
    const es = DEMO ? new DemoEventSource(url) : new EventSource(url);
    source.current = es;

    const handle = (type: string) => (ev: Event) => {
      const event = parseStreamEvent(type, String((ev as MessageEvent).data));
      if (event.kind === "ignore") return;
      if (event.kind === "log") {
        setLines((prev) => [...prev, { step: event.step, msg: event.msg }]);
        return;
      }
      closeSource();
      setRunning(null);
      if (event.kind === "abort") {
        setStreamError(event.msg);
        return;
      }
      if (kind === "signal") setSignal(event.data as Signal);
      else setBacktest(event.data as Backtest);
    };

    es.addEventListener("log", handle("log"));
    es.addEventListener("result", handle("result"));
    es.addEventListener("abort", handle("abort"));
    es.onerror = () => {
      closeSource();
      setRunning(null);
    };
  }

  async function askAi() {
    if (!signal || asking) return;
    setAsking(true);
    setAiError(null);
    try {
      setAi(await api.aiReview(signal.ticker, signal));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  // The run's output is built once here; which template shows it, and in what arrangement, is the
  // only difference between them. The signal is three cards rather than one — what the indicators
  // said, what the spread it picked costs, and what the model made of it — so each stands on its
  // own instead of a single panel that has to be read top to bottom to find one number.
  const reasoningPanel = signal && (
    <Panel title="Signal reasoning">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h3
          className={`font-display font-semibold leading-none tracking-[-0.02em] text-ink ${
            minimal ? "text-[28px]" : "text-[38px]"
          }`}
        >
          {signal.ticker}
        </h3>
        <span className="eyebrow">Spot {formatMoney(signal.spot, { signed: false })}</span>
        <span className="eyebrow">Expires {formatDate(signal.expiration)}</span>
        <span className="eyebrow">{signal.dte} days</span>
      </div>

      <p className="mt-5 border-b border-rule pb-2 font-display text-2xl font-semibold text-ink">
        {spreadLabel(signal.direction)}
      </p>
      {modesAgreeing(signal) && <p className="mt-1 eyebrow">{modesAgreeing(signal)}</p>}

      <DefinitionList
        cards={minimal}
        rows={[
          { label: "RSI", value: signal.indicators ? signal.indicators.rsi.toFixed(1) : "—" },
          { label: "%B", value: signal.indicators ? signal.indicators.pctb.toFixed(2) : "—" },
          { label: "ADX", value: signal.indicators ? signal.indicators.adx.toFixed(1) : "—" },
          { label: "IV %", value: formatPct(signal.iv_pct) },
          { label: "IV rank", value: signal.iv_rank === null ? "building" : formatPct(signal.iv_rank) },
          { label: "IV / RV", value: signal.iv_rv == null ? "—" : signal.iv_rv.toFixed(2) },
        ]}
      />

      <div className="mt-4 space-y-1.5">
        {MODES.map((m) => {
          const verdict = signal.verdicts[m.key];
          if (!verdict) return null;
          return (
            <div key={m.key} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="w-32 shrink-0 eyebrow">{m.label}</span>
              {verdict.reason.includes("CAUTION") && <StatusBadge tone="warn" label="Caution" />}
              <span className="text-ink-2">{verdict.reason}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );

  const spreadPanel = signal?.spread && (
    <Panel title="Credit spread">
      <LegCards spread={signal.spread} />

      <DefinitionList
        cards={minimal}
        rows={[
          {
            label: "Short / long",
            value: `${formatStrike(signal.spread.short)} / ${formatStrike(signal.spread.long)}`,
            // The two strikes together are wider than a tile: give the pair the full row.
            span: true,
          },
          { label: "Width", value: formatMoney(signal.spread.width, { signed: false }) },
          // The engine prices the credit per share; the tile reads it in dollars per contract,
          // the same units as max loss and the payoff levels beside it.
          { label: "Credit", value: formatMoney(signal.spread.credit * 100, { signed: false }) },
          { label: "Max loss", value: formatMoney(signal.spread.max_loss, { signed: false }) },
          { label: "POP", value: formatPct(signal.spread.pop_pct) },
          { label: "Breakeven", value: formatMoney(signal.spread.breakeven, { signed: false }) },
          {
            label: "Short delta",
            value: signal.spread.short_delta == null ? "—" : signal.spread.short_delta.toFixed(2),
          },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" ref={sizeButton} onClick={() => setSizing(true)} className={RUN_BUTTON}>
          Size this trade
        </button>
      </div>
    </Panel>
  );

  // A card of its own because it is not part of the run: nothing is asked of the model until the
  // button is pressed, and what comes back is its opinion, kept apart from the engine's numbers.
  const reviewPanel = signal && (
    <Panel title="AI review">
      <button type="button" onClick={askAi} disabled={asking} className={PRIMARY_BUTTON}>
        {asking ? "Asking AI…" : "Ask AI"}
      </button>

      {ai && (
        <p className="mt-3 flex flex-wrap items-baseline gap-2 text-sm">
          <StatusBadge {...AI_BADGE[ai.verdict]} />
          <span className="text-ink">{ai.reason}</span>
        </p>
      )}
      {aiError && <p className="mt-3 text-sm text-critical">{aiError}</p>}
    </Panel>
  );

  /** The three cards the run is read as, in the order the mockup stacks them. */
  const signalPanels = (
    <>
      {reasoningPanel}
      {spreadPanel}
      {reviewPanel}
    </>
  );

  const payoffPanel = signal?.spread && (
    <Suspense fallback={<Placeholder label="Loading the payoff surface…" />}>
      <PayoffSurfacePanel
        direction={signal.direction}
        shortStrike={signal.spread.short}
        longStrike={signal.spread.long}
        credit={signal.spread.credit}
        contracts={1}
        expiry={signal.expiration}
        ticker={signal.ticker}
      />
    </Suspense>
  );

  const ivPanel = signal && (
    <Suspense fallback={<Placeholder label="Loading the IV surface…" />}>
      <IvSurfacePanel ticker={signal.ticker} spread={signal.spread} dte={signal.dte} />
    </Suspense>
  );

  const logPanel = (lines.length > 0 || running) && (
    <Panel
      title="Log"
      actions={
        running ? (
          <StatusBadge
            tone="neutral"
            label={running === "signal" ? "Running signal" : "Running backtest"}
          />
        ) : undefined
      }
    >
      <StreamLog lines={lines} />
    </Panel>
  );

  const backtestPanel = backtest && <BacktestPanel result={backtest} minimal={minimal} />;

  // Minimal tiles the output the way the mockup does: the reasoning against the payoff surface,
  // then the smile against the backtest. A panel whose partner never arrived takes the whole row
  // rather than sitting in a half-empty one.
  const row = "grid min-w-0 grid-cols-1 gap-6 min-[1100px]:grid-cols-12";
  /** Seven columns when it shares the row, all twelve when it has the row to itself. */
  const wide = (partner: unknown) =>
    `min-w-0 ${partner ? "min-[1100px]:col-span-7" : "min-[1100px]:col-span-12"}`;
  /** Five columns when it shares the row, all twelve when it has the row to itself. */
  const narrow = (partner: unknown) =>
    `min-w-0 ${partner ? "min-[1100px]:col-span-5" : "min-[1100px]:col-span-12"}`;

  return (
    // Both templates read the same way round: the controls in a strip across the top, the run's
    // output underneath.
    <div className="flex flex-col gap-8">
      <div className="min-w-0">
        <Panel title="Study">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <label htmlFor="study-ticker" className={LABEL}>
                Ticker
              </label>
              <input
                id="study-ticker"
                value={ticker}
                placeholder="SPY"
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") run("signal");
                }}
                className={`mt-1.5 w-28 font-display text-lg uppercase ${INPUT}`}
              />
            </div>

            <fieldset>
              <legend className={LABEL}>Days to expiry</legend>
              <div className="mt-1.5 flex flex-wrap">
                {studyDtes(savedDtes, dte).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={dte === d}
                    onClick={() => setDte(d)}
                    className={`seg -ml-px border px-3 py-1 text-sm tabular-nums transition-colors first:ml-0 ${
                      dte === d
                        ? "border-ink bg-ink text-sheet"
                        : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className={LABEL}>Modes</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {MODES.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={modes.includes(m.key)}
                      onChange={() => toggleMode(m.key)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => run("signal")}
                disabled={!ready || running !== null}
                className={PRIMARY_BUTTON}
              >
                Run signal
              </button>
              <button
                type="button"
                onClick={() => run("backtest")}
                disabled={!ready || running !== null}
                className={RUN_BUTTON}
              >
                Run backtest
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {streamError && (
        <Panel title={<StatusBadge tone="critical" label="Run stopped" />}>
          <p className="text-sm text-ink">{streamError}</p>
        </Panel>
      )}

      {minimal ? (
        <div className="flex min-w-0 flex-col gap-6">
          {(signal || payoffPanel) && (
            <div className={row}>
              {signal && (
                <div className={`${narrow(payoffPanel)} flex flex-col gap-6`}>{signalPanels}</div>
              )}
              {payoffPanel && <div className={wide(signal)}>{payoffPanel}</div>}
            </div>
          )}

          {logPanel}

          {(ivPanel || backtestPanel) && (
            <div className={row}>
              {ivPanel && <div className={wide(backtestPanel)}>{ivPanel}</div>}
              {backtestPanel && <div className={narrow(ivPanel)}>{backtestPanel}</div>}
            </div>
          )}
        </div>
      ) : (
        <>
          {signalPanels}
          {payoffPanel}
          {logPanel}
          {backtestPanel}
          {ivPanel}
        </>
      )}

      {sizing && signal && (
        <SizeDrawer signal={signal} modes={selected} aiVerdict={ai} onClose={closeDrawer} />
      )}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <section className="border border-rule-strong bg-well p-4 text-sm text-ink-2">
      {label}
    </section>
  );
}

function DefinitionList({
  rows,
  cards = false,
}: {
  rows: { label: string; value: string; span?: boolean }[];
  /** Minimal sets each reading as a tile; Broadsheet rules them off like a printed table. */
  cards?: boolean;
}) {
  if (cards) {
    return (
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`stat-tile flex min-w-0 flex-col ${row.span ? "col-span-2 sm:col-span-3" : ""}`}
          >
            <dt className="eyebrow">{row.label}</dt>
            <dd className="figure mt-0.5 truncate text-[17px] text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-rule pt-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-sm last:border-0">
          <dt className="eyebrow">{row.label}</dt>
          <dd className="font-display text-[17px] font-semibold tabular-nums text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BacktestPanel({ result, minimal = false }: { result: Backtest; minimal?: boolean }) {
  const { stats, trades } = result;
  const figures = [
    { label: "Trades", value: String(stats.n) },
    // The server sends win rate as a fraction.
    { label: "Win rate", value: stats.win_rate == null ? "—" : formatPct(stats.win_rate * 100) },
    { label: "Average win", value: formatMoney(stats.avg_win) },
    { label: "Average loss", value: formatMoney(stats.avg_loss) },
    { label: "Expectancy", value: formatMoney(stats.expectancy) },
    { label: "Total P&L", value: formatMoney(stats.total_pnl) },
    {
      label: "Profit factor",
      value:
        stats.profit_factor === null
          ? "No losses"
          : stats.profit_factor === undefined
            ? "—"
            : stats.profit_factor.toFixed(2),
    },
    { label: "Max drawdown", value: formatMoney(stats.max_drawdown) },
  ];
  const last = trades.slice(-20);

  return (
    <Panel title="Backtest">
      <div className={`flex flex-col gap-4 ${minimal ? "" : "min-[1100px]:flex-row min-[1100px]:items-start"}`}>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="stat-tile min-w-0">
              <dt className="eyebrow">{f.label}</dt>
              <dd className="figure mt-1 text-[24px] leading-none text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
        <p
          className={
            minimal
              ? "note-card text-sm text-ink-2"
              : "shrink-0 border-l-2 border-ink pl-4 text-sm text-ink-2 min-[1100px]:w-72"
          }
        >
          Win rate alone doesn't show an edge: short strikes are chosen at 30 delta, so about 70% of
          trades win by design. Look at expectancy.
        </p>
      </div>

      {last.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="pb-1.5 pr-3">Entry</th>
                <th className="pb-1.5 pr-3">Expiry</th>
                <th className="pb-1.5 pr-3">Ticker</th>
                <th className="pb-1.5 pr-3">Mode</th>
                <th className="pb-1.5 pr-3">Direction</th>
                <th className="pb-1.5 pr-3">Strikes</th>
                <th className="pb-1.5 pr-3">Contracts</th>
                <th className="num pb-1.5">P&L</th>
              </tr>
            </thead>
            <tbody>
              {last.map((t, i) => (
                <tr key={`${t.ticker}-${t.entry}-${t.short}-${i}`}>
                  <td className="py-2 pr-3 text-ink-2">{formatDate(t.entry)}</td>
                  <td className="py-2 pr-3 text-ink-2">{formatDate(t.expiry)}</td>
                  <td className="py-2 pr-3 font-display text-base font-semibold text-ink">{t.ticker}</td>
                  <td className="py-2 pr-3 text-ink-2">{t.mode}</td>
                  <td className="py-2 pr-3 text-ink-2">{spreadLabel(t.direction)}</td>
                  <td className="py-2 pr-3 text-ink-2">
                    {formatMoney(t.short, { signed: false })} / {formatMoney(t.long, { signed: false })}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{t.contracts}</td>
                  <td className="num py-2 text-ink">{formatMoney(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}