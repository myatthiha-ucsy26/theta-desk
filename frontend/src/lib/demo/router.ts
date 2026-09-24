// The demo desk's server: answers every call the screens make from the simulated book, and refuses
// every call that would change something. Never touches the network, so a demo cannot reach the
// desk's backend, OpenD or a broker, whatever is running on this machine.
import {
  ApiError,
  SECRET_MASK,
  type Account, type AiProvider, type AiVerdict, type BacktestStats, type BacktestTrade, type BotStatus,
  type Decision, type Direction, type EdgeCell, type EngineStatus, type IvSurface, type JournalRow, type LegQuote,
  type Learn, type LiveTrade, type OpenPosition, type OrderEvent, type PaperBook, type Position, type PreflightCheck,
  type Settings, type Signal, type SignalMode, type SizePreview, type Stage,
} from "../api";
import { demoBook, isoDate, SIGMA, SPOTS, spotAt, TICKERS, type DemoClosed, type DemoOpen } from "./book";
import { bsDelta, bsPrice, payoffGrid } from "./pricing";

export const DEMO_REFUSAL = "Demo mode — nothing was sent.";

const DAY = 86_400_000;
const STARTING_CASH = 25_000;
const RISK_CAP = 2_500;
const MAX_OPEN = 5;
/** When this demo was opened: the session's trades start closing from here. */
const SESSION_START = new Date();

/** The book as it stands at `ms`, in this session. */
const bookAt = (ms: number) => demoBook(new Date(ms), SESSION_START);

/** Enough of a pause that a screen shows its loading state for a beat, the way a real desk does. */
const LATENCY_MS = 120;

const cents = (x: number) => Math.round(x * 100) / 100;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settings = (): Settings => ({
  engine_enabled: true, mode: "auto", account_mode: "live", watchlist: TICKERS, modes: ["ivrich"],
  directions: ["SELL_PUT", "SELL_CALL"], dtes: [7, 14], interval_min: 15, ticker_gap_sec: 5,
  market_hours_only: false, edge_min_n: 100, edge_min_expectancy: 0, max_open_positions: MAX_OPEN,
  max_deployed_risk: RISK_CAP, ai_enabled: true, ai_allow_caution: true, edge_enabled: true,
  risk_enabled: true, dedupe_enabled: true, alert_cooldown_hours: 24,
  ai_api_key: SECRET_MASK, ai_api_endpoint: "https://api.anthropic.com/v1", ai_model: "claude-sonnet-5",
  telegram_bot_token: SECRET_MASK, telegram_chat_id: "100200300",
  tp_pct: 50, sl_multiple: 2, min_credit: 0.3, bot_paused: false, bot_pause_reason: "",
  paper_starting_cash: STARTING_CASH, paper_fee_per_contract: 0.65,
});

// ---------------- signals ----------------

function legQuote(ticker: string, strike: number, expiry: string, side: "put" | "call", spot: number, T: number): LegQuote {
  const sigma = SIGMA[ticker];
  const mid = bsPrice(spot, strike, T, sigma, side);
  const code = `US.${ticker}${expiry.slice(2).replace(/-/g, "")}${side === "put" ? "P" : "C"}${Math.round(strike * 1000)}`;
  return {
    strike, code, delta: cents(bsDelta(spot, strike, T, sigma, side) * 100) / 100,
    bid: cents(Math.max(mid - 0.03, 0.01)), ask: cents(mid + 0.03), iv: sigma * 1.1,
    oi: 1200 + Math.round((strike % 37) * 83), volume: 300 + Math.round((strike % 23) * 41),
  };
}

/** A signal on one name, priced off the demo spot: the same shape the engine's signal has. */
export function demoSignal(ticker: string, dte: number, modes: SignalMode[], ms = Date.now()): Signal {
  const t = SPOTS[ticker] ? ticker : "SPY";
  const spot = spotAt(t, ms);
  const sigma = SIGMA[t];
  const T = dte / 365;
  const expiry = isoDate(ms + dte * DAY);
  const direction: Direction = t === "TSLA" ? "SELL_CALL" : "SELL_PUT";
  const side = direction === "SELL_PUT" ? "put" : "call";
  const step = spot >= 200 ? 5 : 2.5;
  const short = Math.round((side === "put" ? spot * (1 - sigma * Math.sqrt(T)) : spot * (1 + sigma * Math.sqrt(T))) / step) * step;
  const long = side === "put" ? short - 5 : short + 5;
  const shortLeg = legQuote(t, short, expiry, side, spot, T);
  const longLeg = legQuote(t, long, expiry, side, spot, T);
  const credit = cents(Math.max((shortLeg.bid ?? 0) - (longLeg.ask ?? 0), 0.3));
  const em = cents(spot * sigma * 1.1 * Math.sqrt(T));
  const all: Record<SignalMode, { direction: Direction; reason: string }> = {
    ivrich: { direction, reason: `IV rich (IV/RV=1.31, IV rank 72) — sell premium ${side === "put" ? "below" : "above"} the move` },
    meanrev: { direction: "NO_TRADE", reason: "RSI 54 inside the bands — nothing to fade" },
    trend: { direction, reason: side === "put" ? "uptrend (EMA20>EMA50, price>EMA20, ADX 27)" : "downtrend (EMA20<EMA50, ADX 24)" },
  };
  return {
    ticker: t, spot, expiration: expiry, dte, modes, direction,
    expected_move: em, sd1_down: cents(spot - em), sd1_up: cents(spot + em),
    iv_pct: cents(sigma * 110), iv_rank: 72, iv_rv: 1.31,
    indicators: { rsi: 54.2, pctb: 0.61, adx: 27.4, ema20: cents(spot * 0.992), ema50: cents(spot * 0.975), last_close: spot },
    verdicts: all,
    spread: {
      side, short, long, width: 5, credit, max_loss: cents((5 - credit) * 100),
      roi_pct: cents((credit / (5 - credit)) * 100), pop_pct: cents((1 - Math.abs(shortLeg.delta ?? 0.2)) * 100),
      breakeven: side === "put" ? short - credit : short + credit,
      short_delta: shortLeg.delta ?? undefined, em_distance: cents(Math.abs(spot - short) / em),
      short_leg: shortLeg, long_leg: longLeg,
    },
  };
}

// ---------------- the scan ----------------

/** How the last cycle went for each name: most stop early, as they do on a real desk. */
const OUTCOMES: [string, Stage, boolean, string][] = [
  ["SPY", "alert", true, "all gates passed — alert sent"],
  ["QQQ", "signal", false, "ivrich: IV not rich (IV/RV=1.02)"],
  ["AAPL", "signal", false, "ivrich: IV not rich (IV/RV=0.97)"],
  ["MSFT", "risk", false, "MSFT already held — one position per ticker"],
  ["GOOGL", "tradeable", false, "no spread fits (open interest floor / $500 risk cap)"],
  ["AMZN", "signal", false, "ivrich: IV rank 31 — below the bucket that pays"],
  ["META", "edge", false, "edge: ivrich 7d mid IV rank — expectancy -$4 over 212 trades"],
  ["TSLA", "dedupe", false, "same alert sent 3h ago — inside the 24h cooldown"],
  ["AVGO", "ai", false, "AI review: AVOID — earnings in 4 days"],
  ["AMD", "signal", false, "ivrich: IV not rich (IV/RV=1.08)"],
];

function journal(ms: number): JournalRow[] {
  return OUTCOMES.map(([ticker, stage, passed, reason], i) => {
    const traded = stage !== "signal";
    const signal = demoSignal(ticker, 7, ["ivrich"], ms);
    const decision: Decision = {
      ticker, dte: 7, modes: ["ivrich"], stage, passed, direction: traded ? signal.direction : "NO_TRADE", reason,
      signal: traded ? signal : { ...signal, direction: "NO_TRADE", spread: null }, edge: [],
      alert_key: stage === "alert" ? `${ticker}-7-${signal.direction}` : null,
      ai_verdict: stage === "alert" ? "CONFIRM" : stage === "ai" ? "AVOID" : null,
      ai_reason: stage === "alert" ? "Premium is rich and the short strike sits outside the expected move." : stage === "ai" ? "Earnings inside the trade." : null,
      alert_sent: stage === "alert", alert_error: null, skipped: [],
      confidence: { agree: traded ? 2 : 0, of: 3, win_rate: traded ? 0.81 : null, n: traded ? 847 : null },
    };
    return { id: 9000 - i, ts: iso(ms - 3 * 60_000 - i * 5_000), decision };
  });
}

// ---------------- the books ----------------

function paperBook(ms: number): PaperBook {
  const { closed, open } = bookAt(ms);
  const toPosition = (t: DemoClosed): Position => ({
    id: t.id, ticker: t.ticker, direction: t.direction, short_strike: t.short, long_strike: t.long,
    width: t.width, credit: t.credit, contracts: t.contracts, entry_date: t.openedAt.slice(0, 10), expiry: t.expiry,
    mode: "ivrich", status: "closed", close_date: t.closedAt.slice(0, 10), close_pnl: t.pnl, entry_context: null,
  });
  const toOpen = (t: DemoOpen): OpenPosition => {
    const risk = cents((t.width - t.credit) * 100 * t.contracts);
    const maxProfit = cents(t.credit * 100 * t.contracts);
    const distance = t.direction === "SELL_PUT" ? (t.spot - t.short) / t.spot : (t.short - t.spot) / t.spot;
    const profitPct = cents(((t.credit - t.mark) / t.credit) * 100);
    return {
      id: t.id, ticker: t.ticker, direction: t.direction, short_strike: t.short, long_strike: t.long, width: t.width,
      credit: t.credit, contracts: t.contracts, entry_date: t.openedAt.slice(0, 10), expiry: t.expiry, mode: "ivrich",
      status: "open", close_date: null, close_pnl: null, entry_context: null,
      spot: t.spot, mtm_pnl: t.pnl, days_left: Math.max(0, Math.round((Date.parse(t.expiry) - ms) / DAY)),
      max_profit: maxProfit, risk, distance_pct: cents(distance * 100), short_breached: distance < 0,
      profit_pct: profitPct, profit_take_hit: profitPct >= 50,
    };
  };
  const wins = closed.filter((t) => t.pnl > 0).length;
  const openRows = open.map(toOpen);
  return {
    open: openRows, closed: closed.map(toPosition).reverse(),
    stats: {
      total_pnl: cents(closed.reduce((s, t) => s + t.pnl, 0)), wins, losses: closed.length - wins,
      win_rate: wins / closed.length, open_count: open.length,
      deployed_risk: cents(openRows.reduce((s, p) => s + p.risk, 0)), risk_cap: RISK_CAP,
    },
  };
}

function account(ms: number): Account {
  const { closed, open } = bookAt(ms);
  const realised = closed.reduce((s, t) => s + t.pnl, 0);
  const unrealised = cents(open.reduce((s, t) => s + t.pnl, 0));
  const risk = open.reduce((s, t) => s + (t.width - t.credit) * 100 * t.contracts, 0);
  return {
    account: "live", currency: "USD", cash: cents(STARTING_CASH + realised),
    net_value: cents(STARTING_CASH + realised + unrealised), buying_power: cents(STARTING_CASH + realised - risk),
    unrealized_pl: unrealised, open_count: open.length,
  };
}

function bot(ms: number): BotStatus {
  const { closed, open } = bookAt(ms);
  const live = (t: DemoClosed | DemoOpen, state: LiveTrade["state"]): LiveTrade => {
    const done = "closedAt" in t;
    return {
      id: t.id, ticker: t.ticker, direction: t.direction, expiry: t.expiry, short_strike: t.short, long_strike: t.long,
      width: t.width, contracts: t.contracts, planned_credit: t.credit, state, credit: t.credit,
      tp_order_id: done ? null : `demo-tp-${t.id}`, tp_tif: done ? null : "GTC", sl_hits: 0,
      close_price: done ? t.closeDebit : null, exit_reason: done ? t.exitReason : null,
      close_debit: done ? t.closeDebit : null, fees: done ? t.fees : cents(0.65 * 2 * t.contracts),
      pnl: done ? t.pnl : null, ai_reason: "Premium is rich and the short strike sits outside the expected move.",
      last_ai_check: iso(ms - 20 * 60_000), opened_at: t.openedAt, filled_at: t.openedAt, closed_at: done ? t.closedAt : null,
    };
  };
  const net = cents(closed.reduce((s, t) => s + t.pnl, 0));
  const events: OrderEvent[] = [...open.map((t) => [t, "open"] as const), ...closed.slice(-8).map((t) => [t, "close"] as const)]
    .map(([t, action], i) => ({
      id: 5000 - i, ts: action === "open" ? t.openedAt : (t as DemoClosed).closedAt, trade_id: t.id,
      action: action === "open" ? "entry_filled" : `exit_${(t as DemoClosed).exitReason}`,
      order_id: `demo-${t.id}-${action}`, price: action === "open" ? t.credit : (t as DemoClosed).closeDebit,
      status: "FILLED_ALL", reason: null,
    }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    mode: "auto", account_mode: "live", paused: false, pause_reason: "",
    monitor: { state: "watching", last_ok: iso(ms - 15_000), last_error: null },
    net_pnl: net, slots: 1 + Math.floor(Math.max(net, 0) / 500), next_slot_at: (1 + Math.floor(Math.max(net, 0) / 500)) * 500,
    active: open.map((t) => live(t, "open")), closed: closed.map((t) => live(t, "closed")).reverse(),
    marks: Object.fromEntries(open.map((t) => [t.id, t.mark])), events,
  };
}

function engineStatus(ms: number): EngineStatus {
  return {
    running: true, state: "idle", engine_enabled: true, mode: "auto", account_mode: "live", market_hours_only: false,
    last_tick: iso(ms - 10_000), last_cycle: iso(ms - 3 * 60_000), last_error: null,
    edge_built_at: iso(ms - 6 * 3_600_000), decisions: 1284, alerts: 37, last_trigger: "schedule",
    next_scan_at: iso(ms + 12 * 60_000),
  };
}

function learn(days: number): Learn {
  const stages: [Stage, number][] = [["signal", 412], ["tradeable", 96], ["edge", 71], ["risk", 52], ["ai", 40], ["dedupe", 31], ["alert", 24]];
  const scale = days / 7;
  const reached = stages.map(([, n]) => Math.round(n * scale));
  const cells: EdgeCell[] = [];
  const modes: SignalMode[] = ["ivrich", "meanrev", "trend"];
  modes.forEach((mode, mi) => [7, 14].forEach((dte, di) =>
    (["low", "mid", "high"] as const).forEach((bucket, bi) => {
      const expectancy = cents([[-6, 11, 38], [-14, 4, 19], [-22, -3, 12]][mi][bi] + di * 3);
      const n = 180 + mi * 40 + bi * 90 + di * 30;
      cells.push({ mode, dte, bucket, n, expectancy, win_rate: 0.72 + bi * 0.05, validated: true, passes: expectancy > 0 });
    })));
  return {
    days, decisions: reached[0], errors: 0,
    funnel: stages.map(([stage], i) => ({ stage, reached: reached[i], stopped: reached[i] - (reached[i + 1] ?? 0) })),
    edge: cells, edge_built_at: iso(Date.now() - 6 * 3_600_000), min_n: 100,
    paper: [{ mode: "ivrich", paper_n: 48, paper_win_rate: 0.79, paper_expectancy: 18.6, paper_total: 893, backtest_n: 847, backtest_expectancy: 37.7 }],
  };
}

function ivSurface(ticker: string, ms: number): IvSurface {
  const t = SPOTS[ticker] ? ticker : "SPY";
  const spot = spotAt(t, ms);
  const base = SIGMA[t];
  const dtes = [2, 7, 14, 21, 35, 63];
  const step = spot >= 200 ? 5 : 2.5;
  const strikes = Array.from({ length: 21 }, (_, i) => Math.round((spot * (0.85 + i * 0.015)) / step) * step);
  // Put skew (dearer below spot), a smile at the wings, and a term structure that flattens out.
  const iv = dtes.map((d) => strikes.map((k) => {
    const m = Math.log(k / spot);
    return Math.round((base * (1 + 0.25 / Math.sqrt(d)) - 0.35 * m + 1.4 * m * m) * 1e4) / 1e4;
  }));
  const flat = iv.flat();
  return {
    ticker: t, spot, expiries: dtes.map((d) => isoDate(ms + d * DAY)), dtes, strikes, iv,
    min_iv: Math.min(...flat), max_iv: Math.max(...flat),
  };
}

// ---------------- Study ----------------

export function demoBacktest(ticker: string, dte: number): { stats: BacktestStats; trades: BacktestTrade[] } {
  const { closed } = demoBook();
  const trades: BacktestTrade[] = closed.map((c) => ({
    ticker: SPOTS[ticker] ? ticker : "SPY", entry: c.openedAt.slice(0, 10), expiry: c.expiry, dte, mode: "ivrich",
    direction: c.direction, iv_rank: 60 + (c.short % 30), short: c.short, long: c.long, width: c.width,
    credit: c.credit, max_loss: cents((c.width - c.credit) * 100), contracts: c.contracts, pnl: c.pnl, win: c.pnl > 0,
  }));
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  let cum = 0, peak = 0, mdd = 0;
  for (const p of pnls) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); }
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  return {
    stats: {
      n: trades.length, win_rate: wins.length / trades.length,
      avg_win: cents(wins.reduce((s, p) => s + p, 0) / wins.length), avg_loss: cents(losses.reduce((s, p) => s + p, 0) / losses.length),
      expectancy: cents(cum / trades.length), total_pnl: cents(cum),
      profit_factor: grossLoss ? cents(wins.reduce((s, p) => s + p, 0) / grossLoss) : null, max_drawdown: cents(mdd),
    },
    trades,
  };
}

// ---------------- routing ----------------

const PROVIDERS: AiProvider[] = [{
  id: "anthropic", label: "Anthropic", url: "https://api.anthropic.com/v1", auth: "key",
  models: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }, { id: "claude-opus-5-5", label: "Claude Opus 5.5" }],
}];

const PREFLIGHT: PreflightCheck[] = [
  "Telegram configured", "AI key configured", "Bot monitor running", "OpenD connected to the real account", "Trading unlocked",
].map((name) => ({ name, ok: true, detail: "" }));

function answerGet(path: string, q: URLSearchParams, ms: number): unknown {
  switch (path) {
    case "/api/engine/status": return engineStatus(ms);
    case "/api/scan/latest": return journal(ms);
    case "/api/journal": return journal(ms).slice(0, Number(q.get("limit") ?? 100));
    case "/api/settings": return settings();
    case "/api/settings/defaults": return { watchlist: TICKERS };
    case "/api/ai/providers": return PROVIDERS;
    case "/api/bot": return bot(ms);
    case "/api/bot/preflight": return { checks: PREFLIGHT, ready: true };
    case "/api/paper": return paperBook(ms);
    case "/api/account": return account(ms);
    case "/api/learn": return learn(Math.max(1, Math.min(90, Number(q.get("days") ?? 7))));
    case "/api/signal":
      return demoSignal((q.get("ticker") ?? "SPY").toUpperCase(), Number(q.get("dte") ?? 7), (q.get("modes") ?? "ivrich").split(",") as SignalMode[], ms);
    case "/api/iv-surface": return ivSurface((q.get("ticker") ?? "SPY").toUpperCase(), ms);
    default: throw new ApiError(`Not in the demo: ${path}`, 404);
  }
}

type Body = Record<string, unknown>;

/** The posts that only calculate. Anything else would change the desk, so the demo refuses it. */
function answerPost(path: string, body: Body, ms: number): unknown {
  if (path === "/api/payoff") {
    const ticker = String(body.ticker ?? "SPY").toUpperCase();
    const days = body.days_left !== undefined ? Number(body.days_left)
      : body.expiry ? Math.round((Date.parse(String(body.expiry)) - ms) / DAY) : 7;
    return payoffGrid(body.direction as Direction, Number(body.short_strike), Number(body.long_strike), Number(body.credit),
      Number(body.contracts ?? 1), body.spot !== undefined ? Number(body.spot) : spotAt(SPOTS[ticker] ? ticker : "SPY", ms),
      days, body.sigma !== undefined ? Number(body.sigma) : SIGMA[ticker] ?? 0.25);
  }
  if (path === "/api/size/preview") {
    const signal = body.signal as Signal;
    const risk = signal.spread ? signal.spread.max_loss : 0;
    const before = paperBook(ms).stats.deployed_risk;
    const preview: SizePreview = {
      ticker: String(body.ticker), contracts: 1, trade_risk: risk, credit_total: cents((signal.spread?.credit ?? 0) * 100),
      deployed_before: before, deployed_after: cents(before + risk), cap: RISK_CAP, open_positions: 4,
      max_open_positions: MAX_OPEN, ok: before + risk <= RISK_CAP, reason: "",
    };
    return preview;
  }
  if (path === "/api/ai/confirm") {
    const verdict: AiVerdict = {
      verdict: "CONFIRM", reason: "IV is rich against realised vol and the short strike sits outside the expected move.",
      raw: "VERDICT: CONFIRM",
    };
    return verdict;
  }
  throw new ApiError(DEMO_REFUSAL, 403);
}

export async function demoRequest(path: string, init?: RequestInit): Promise<unknown> {
  await sleep(LATENCY_MS);
  const [route, query = ""] = path.split("?");
  const ms = Date.now();
  if ((init?.method ?? "GET").toUpperCase() === "GET") return answerGet(route, new URLSearchParams(query), ms);
  const body = typeof init?.body === "string" && init.body ? (JSON.parse(init.body) as Body) : {};
  return answerPost(route, body, ms);
}
