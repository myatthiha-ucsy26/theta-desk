import { useEffect, useRef, useState } from "react";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import {
  api,
  type EdgeCell,
  type Learn as LearnReport,
  type Settings,
  type SignalMode,
  type Stage,
} from "../lib/api";
import { divergingColor, PALETTES } from "../lib/colors";
import { edgeSummary, pairedSpan } from "../lib/learn";
import { hrefFor } from "../lib/route";
import { useTheme } from "../lib/theme";
import { formatTime } from "../lib/time";
import { useTemplate } from "../lib/templates";
import { usePoll } from "../lib/usePoll";
import { GATES, formatMoney, formatPct } from "../lib/views";

const POLL_MS = 60000;
const PERIODS = [7, 30, 90] as const;

const FUNNEL: { stage: Stage; label: string }[] = [
  ...GATES.map((g) => ({ stage: g.stage as Stage, label: g.label })),
  { stage: "alert", label: "Alert sent" },
];

const MODE_LABEL: Record<SignalMode, string> = {
  ivrich: "IV rich",
  meanrev: "Mean reversion",
  trend: "Trend",
};

const BUCKETS = [
  { key: "low", label: "Low" },
  { key: "mid", label: "Mid" },
  { key: "high", label: "High" },
  { key: "unranked", label: "Unranked" },
] as const;

const TOGGLE = "border px-2.5 py-1 text-sm tabular-nums transition-colors";

/**
 * What each gate reads, as it reads it.
 *
 * These are the engine's own conditions rather than a gloss on them: the floors and the target
 * delta are the constants the scan runs on, and the sample minimum, the risk cap and the cooldown
 * are read back from the desk's settings so a line here cannot go stale against the engine.
 */
const condition = (stage: Stage, s: Settings | null, minN: number | undefined): string => {
  switch (stage) {
    case "signal":
      return "One mode fires a side, and no other mode fires the other way.";
    case "tradeable":
      return "A spread fits: every leg above the open-interest floor, the short strike nearest 0.30 delta, credit above zero, and the width less the credit inside the $500 cap.";
    case "edge":
      return `The modes that fired have a pooled setup with at least ${minN ?? "—"} trades at positive expectancy.`;
    case "risk":
      return s
        ? `A free slot under ${s.max_open_positions}, nothing already held in the ticker, and deployed risk inside $${s.max_deployed_risk.toFixed(0)}.`
        : "A free slot, nothing already held in the ticker, and deployed risk inside the cap.";
    case "ai":
      return s && s.ai_allow_caution && s.mode === "manual"
        ? "The model clears it. A confirm or a caution is taken in manual; auto takes only a confirm."
        : "The model returns a confirm. A caution is not enough here.";
    case "dedupe":
      return s
        ? `This exact spread — ticker, side, both strikes, expiration — hasn't been alerted in the last ${s.alert_cooldown_hours}h.`
        : "This exact spread hasn't been alerted inside the cooldown.";
    default:
      return "Every gate cleared and the alert was delivered.";
  }
};

export function Learn() {
  const [days, setDays] = useState<number>(7);
  const ordinal = PALETTES[useTheme()].ordinal;
  const report = usePoll(() => api.learn(days), POLL_MS);
  // The explainer quotes the desk's own thresholds, so it reads them rather than restating a
  // default that would go stale the moment one is changed in Settings.
  const desk = usePoll(() => api.settings(), POLL_MS);

  // The poll keeps the loader in a ref, so a period change asks for itself.
  const asked = useRef(days);
  useEffect(() => {
    if (asked.current === days) return;
    asked.current = days;
    void report.refresh();
  }, [days, report.refresh]);

  const data = report.data;
  const funnel = data?.funnel ?? [];
  const widest = funnel.reduce((m, f) => Math.max(m, f.reached), 0);
  const cells = data?.edge ?? [];
  const maxAbs = cells.reduce((m, c) => Math.max(m, Math.abs(c.expectancy)), 0);
  const modes = [...new Set(cells.map((c) => c.mode))];
  const summary = edgeSummary(cells);
  // Minimal runs the funnel as gate rows and sets the paper record as a paired plot, where
  // Broadsheet draws a bar per gate and a table. The edge matrix stays a table under both: a grid
  // of cells is what it is.
  const minimal = useTemplate() === "minimal";

  return (
    <div className="flex flex-col gap-8">
      {data && <ProofEngine summary={summary} />}

      <Panel
        title="Where scans stop"
        actions={
          <div className="flex">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`seg -ml-px first:ml-0 ${TOGGLE} ${
                  days === p ? "border-ink bg-ink text-sheet" : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
                }`}
              >
                {p} days
              </button>
            ))}
          </div>
        }
      >
        {report.error && <p className="text-sm text-critical">{report.error}</p>}
        {!data && !report.error && <p className="text-sm text-ink-2">Loading the funnel…</p>}

        {data && (
          <>
            {minimal ? (
              <GateRows funnel={funnel} widest={widest} settings={desk.data} minN={data.min_n} />
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.map((f, i) => {
                  const label = FUNNEL.find((x) => x.stage === f.stage)?.label ?? f.stage;
                  const color = ordinal[Math.min(i, ordinal.length - 1)];
                  return (
                    <div key={f.stage} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 eyebrow">{label}</span>
                      <span
                        className="h-3.5"
                        style={{
                          width: `${widest ? (f.reached / widest) * 100 : 0}%`,
                          backgroundColor: color,
                        }}
                        title={`${f.reached} reached, ${f.stopped} stopped here`}
                      />
                      <span className="w-12 shrink-0 num text-sm text-ink">{f.reached}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {data.errors > 0 && (
              <p className="mt-4 text-sm text-ink-2">
                {data.errors} of {data.decisions} scans stopped on a data error, not a rule.
              </p>
            )}
          </>
        )}
      </Panel>

      <WhyTheFunnelWorks />

      <Panel title="Backtest edge by setup">
        {data && cells.length === 0 && (
          <p className="text-sm text-ink-2">
            The edge table hasn't been built yet. It builds on the engine's first cycle.
          </p>
        )}

        {modes.map((mode) => {
          const rows = [...new Set(cells.filter((c) => c.mode === mode).map((c) => c.dte))].sort(
            (a, b) => a - b,
          );
          return (
            <div key={mode} className="mb-6 last:mb-0">
              <h3 className="eyebrow border-b border-rule pb-1 text-ink">{MODE_LABEL[mode]}</h3>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="w-16 pb-1.5 pr-3">DTE</th>
                      {BUCKETS.map((b) => (
                        <th key={b.key} className="num px-3 pb-1.5">
                          {b.label} IV rank
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((dte) => (
                      <tr key={dte}>
                        <th scope="row" className="num py-2 pr-3 text-ink-2">
                          {dte}
                        </th>
                        {BUCKETS.map((b) => (
                          <EdgeCellView
                            key={b.key}
                            cell={cells.find(
                              (c) => c.mode === mode && c.dte === dte && c.bucket === b.key,
                            )}
                            maxAbs={maxAbs}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {data && cells.length > 0 && (
          <p className="mt-4 text-sm text-ink-2">
            {data.edge_built_at ? `Built ${formatTime(data.edge_built_at)}. ` : ""}
            A setup needs at least {data.min_n} trades and positive expectancy to pass.
          </p>
        )}
      </Panel>

      <Panel title="Paper results vs backtest">
        {data && data.paper.length === 0 ? (
          <p className="text-sm text-ink-2">
            No paper trades yet. Record one from Study to compare it with the backtest.
          </p>
        ) : minimal ? (
          <PairedPlot rows={data?.paper ?? []} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pb-1.5 pr-3">Mode</th>
                  <th className="num px-2 pb-1.5">Paper trades</th>
                  <th className="num px-2 pb-1.5">Paper win rate</th>
                  <th className="num px-2 pb-1.5">Paper expectancy</th>
                  <th className="num px-2 pb-1.5">Backtest expectancy (gated)</th>
                  <th className="num px-2 pb-1.5">Backtest trades</th>
                </tr>
              </thead>
              <tbody>
                {(data?.paper ?? []).map((row) => (
                  <tr key={row.mode}>
                    <th scope="row" className="py-2 pr-3 text-left font-display text-base font-semibold text-ink">
                      {row.mode}
                    </th>
                    <td className="num px-2 py-2 text-ink-2">{row.paper_n}</td>
                    <td className="num px-2 py-2 text-ink-2">
                      {formatPct(row.paper_win_rate * 100)}
                    </td>
                    <td className="num px-2 py-2 text-ink-2">
                      {formatMoney(row.paper_expectancy, { signed: true })}
                    </td>
                    <td className="num px-2 py-2 text-ink-2">
                      {formatMoney(row.backtest_expectancy, { signed: true })}
                    </td>
                    <td className="num px-2 py-2 text-ink-2">{row.backtest_n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * What the edge table adds up to, in four tiles: how much of it is measured, how much is behind it,
 * what it won, and which setup came out best. Every figure is summed off the cells the engine
 * built — nothing here is modelled on top of them.
 */
function ProofEngine({ summary }: { summary: ReturnType<typeof edgeSummary> }) {
  const win = summary.winRate === null ? "—" : formatPct(summary.winRate * 100);
  const best = summary.best;
  // The terminal sets each reading in a tile of its own. Broadsheet rules the row off and lets the
  // readings sit on the page, so the caption under each is the quiet register rather than a class.
  const minimal = useTemplate() === "minimal";
  const tile = minimal ? "stat-tile flex min-w-0 flex-col" : "flex min-w-0 flex-col";
  const sub = minimal ? "stat-sub" : "mt-1 text-xs leading-relaxed text-ink-2";
  return (
    <Panel title="Empirical proof engine">
      <dl
        className={
          minimal
            ? "grid grid-cols-2 gap-3 min-[900px]:grid-cols-4"
            : "grid grid-cols-2 gap-x-6 gap-y-5 border-t border-rule pt-4 min-[900px]:grid-cols-4"
        }
      >
        <div className={tile}>
          <dt className="eyebrow">Setups measured</dt>
          <dd className="figure mt-0.5 text-[17px] text-ink">
            {summary.validated} <span className="text-ink-2">of {summary.setups}</span>
          </dd>
          <p className={sub}>
            {summary.passing} pass the gate; the rest are short of the sample or below zero.
          </p>
        </div>
        <div className={tile}>
          <dt className="eyebrow">Trades behind them</dt>
          <dd className="figure mt-0.5 text-[17px] text-ink">{summary.samples}</dd>
          <p className={sub}>Pooled across every ticker the engine scans.</p>
        </div>
        <div className={tile}>
          <dt className="eyebrow">Win rate</dt>
          <dd className="figure mt-0.5 text-[17px] text-ink">{win}</dd>
          <p className={sub}>
            {summary.rated > 0
              ? `Weighted by trades, over the ${summary.rated} that carry one.`
              : "No setup in the table carries a win rate yet."}
          </p>
        </div>
        <div className={tile}>
          <dt className="eyebrow">Best measured setup</dt>
          <dd className={`figure mt-0.5 text-[17px] ${best ? "text-profit" : "text-ink-2"}`}>
            {best ? formatMoney(best.expectancy, { signed: true }) : "—"}
          </dd>
          <p className={sub}>
            {best
              ? `${MODE_LABEL[best.mode]} at ${best.dte}d, ${best.bucket} IV rank, per trade.`
              : "Nothing has enough trades behind it to be measured."}
          </p>
        </div>
      </dl>
    </Panel>
  );
}

/**
 * The funnel as the gates themselves: what each one reads, how many scans reached it, and how many
 * it turned away. The gate that turned away the most is the one worth finding, so it is marked —
 * computed from this period's own numbers rather than asserted.
 */
function GateRows({
  funnel,
  widest,
  settings,
  minN,
}: {
  funnel: LearnReport["funnel"];
  widest: number;
  settings: Settings | null;
  minN: number | undefined;
}) {
  const rules = funnel.filter((f) => f.stage !== "alert");
  const worst = rules.reduce<LearnReport["funnel"][number] | null>(
    (m, f) => (m === null || f.stopped > m.stopped ? f : m),
    null,
  );

  return (
    <ol className="flex flex-col gap-2.5">
      {funnel.map((f, i) => {
        const label = FUNNEL.find((x) => x.stage === f.stage)?.label ?? f.stage;
        const key = worst !== null && f.stage === worst.stage && worst.stopped > 0;
        const body = (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="gate-badge">{f.stage === "alert" ? "ALERT" : `GATE ${String(i + 1).padStart(2, "0")}`}</span>
              <span className="text-sm font-semibold text-ink">{label}</span>
              {key && <span className="eyebrow text-accent">Most turned away here</span>}
              <span className="ml-auto flex items-baseline gap-x-3">
                <span className="num text-sm text-ink">{f.reached} reached</span>
                <span className="num text-xs text-ink-2">{f.stopped} stopped here</span>
              </span>
            </div>
            <p className="text-xs text-ink-2">{condition(f.stage, settings, minN)}</p>
            <span className="step-track">
              <span className="step-bar" style={{ width: `${widest ? (f.reached / widest) * 100 : 0}%` }} />
            </span>
          </>
        );
        const box = `gate-row flex flex-col gap-2 ${key ? "gate-row-key" : ""}`;
        // Every gate opens the board on the scans it turned back, which is what the funnel is
        // counting. Alert sent is the end of the run rather than a gate, so it stays a reading.
        return (
          <li key={f.stage}>
            {f.stage === "alert" ? (
              <div className={box}>{body}</div>
            ) : (
              <a
                className={box}
                href={hrefFor("scan", { stopped: f.stage })}
                aria-label={`${label}: ${f.reached} reached, ${f.stopped} stopped here. Open Scan on the scans that stopped at this gate.`}
              >
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Why the pipeline is shaped the way it is. Three claims, each one the reason a piece of it exists,
 * kept in the register of an argument rather than a slogan.
 */
function WhyTheFunnelWorks() {
  const minimal = useTemplate() === "minimal";
  const cards: { title: string; body: string }[] = [
    {
      title: "The gates run in order, and the first failure ends the scan",
      body: "Every candidate enters at gate one and walks the same six in the same order. The stage it stopped at is the rule that turned it away, recorded as it happened — the drop-off is not a label put on afterwards, it is the decision.",
    },
    {
      title: "The edge table pools every ticker rather than keeping a row per name",
      body: "One ticker in one mode yields roughly fifteen trades, and thirteen wins out of fifteen happens about one time in eight even when the real win rate is a loser. That is far too thin to gate a trade on. Pooled across the universe, the same cell runs into the hundreds.",
    },
    {
      title: "A setup is judged on expectancy, not on how often it wins",
      body: "The gate reads dollars per trade over the sample. A cell under the sample minimum is marked unvalidated and the gate will not pass on it however good its number looks — and a gate can be switched off in Settings, in which case the scan says it skipped rather than pretending it passed.",
    },
  ];
  return (
    <Panel title="Why the funnel works">
      <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-3">
        {cards.map((c) => (
          <li
            key={c.title}
            className={
              // A card each in the terminal; Broadsheet sets them as three columns of the argument,
              // marked off by a rule down the left rather than boxed.
              minimal
                ? "opinion-card flex flex-col gap-1.5"
                : "flex flex-col gap-1.5 border-l-2 border-rule-strong pl-4"
            }
          >
            <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
            <p className="text-xs leading-relaxed text-ink-2">{c.body}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Paper and backtest on one scale. The mockup's curve is a time series the app does not keep —
 * Learn carries a summary per mode, not a P&L history — so the same card, legend and callout
 * frame a comparison the app can actually make: what the desk earned per trade against what the
 * backtest said it would.
 */
function PairedPlot({ rows }: { rows: LearnReport["paper"] }) {
  const span = pairedSpan(rows);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="pair-bar pair-bar-backtest h-2 w-4 rounded-sm" />
          Backtest, gated
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="pair-bar pair-bar-paper h-2 w-4 rounded-sm" />
          Paper, closed
        </span>
        <span className="ml-auto">Per trade, on one scale across every mode.</span>
      </p>

      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.mode} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-display text-[17px] font-semibold text-ink">
                {MODE_LABEL[row.mode as SignalMode] ?? row.mode}
              </span>
              <span className="num text-xs text-ink-2">
                {row.paper_n} paper {row.paper_n === 1 ? "trade" : "trades"} against {row.backtest_n}{" "}
                backtest
              </span>
            </div>
            <PairBar label="Backtest" value={row.backtest_expectancy} span={span} series="backtest" />
            <PairBar label="Paper" value={row.paper_expectancy} span={span} series="paper" />
            {row.backtest_expectancy !== null && (
              <p className="text-xs text-ink-2">
                {gapWords(row.paper_expectancy, row.backtest_expectancy)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One series of the pair: the bar is drawn from the centre, so a loss runs left and a gain right. */
function PairBar({
  label,
  value,
  span,
  series,
}: {
  label: string;
  value: number | null;
  span: number | null;
  series: "backtest" | "paper";
}) {
  const width = span !== null && value !== null ? (Math.abs(value) / span) * 50 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="eyebrow w-16 shrink-0">{label}</span>
      <span className="pair-track min-w-0 flex-1">
        <span aria-hidden="true" className="pair-axis" />
        {span !== null && value !== null && (
          <span
            aria-hidden="true"
            className={`pair-bar pair-bar-${series}`}
            style={{ width: `${width}%`, left: value >= 0 ? "50%" : `${50 - width}%` }}
          />
        )}
      </span>
      <span
        className={`num w-16 shrink-0 text-right text-sm ${
          value === null ? "text-ink-2" : value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-ink"
        }`}
      >
        {formatMoney(value, { signed: true })}
      </span>
    </div>
  );
}

/** How far the paper record has drifted from the backtest it is meant to be tracking, in dollars. */
function gapWords(paper: number, backtest: number): string {
  const gap = paper - backtest;
  const size = formatMoney(Math.abs(gap), { signed: false });
  if (Math.abs(gap) < 0.005) return "Tracking the backtest to the cent.";
  return gap > 0
    ? `Running ${size} a trade ahead of the backtest.`
    : `Running ${size} a trade behind the backtest.`;
}

function EdgeCellView({ cell, maxAbs }: { cell: EdgeCell | undefined; maxAbs: number }) {
  const theme = useTheme();
  if (!cell) return <td className="num px-3 py-2 text-ink-2">—</td>;
  const tint = divergingColor(cell.expectancy, maxAbs, theme);
  return (
    <td
      className="px-3 py-2 align-top"
      style={{
        borderLeft: `4px solid ${tint}`,
        backgroundColor: `color-mix(in srgb, ${tint} 10%, transparent)`,
      }}
    >
      <div className="num font-display text-[17px] font-semibold text-ink">{formatMoney(cell.expectancy, { signed: true })}</div>
      <div className="eyebrow mt-0.5">{cell.n} trades</div>
      {cell.passes && (
        <div className="mt-1">
          <StatusBadge tone="good" label="Passes" />
        </div>
      )}
      {!cell.validated && <div className="eyebrow mt-1">Too few trades</div>}
    </td>
  );
}