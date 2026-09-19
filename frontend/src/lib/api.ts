// Typed client for the Flask API. Field names mirror app.py exactly.

export type Direction = "SELL_PUT" | "SELL_CALL" | "NO_TRADE";
export type Stage = "signal" | "tradeable" | "edge" | "risk" | "ai" | "dedupe" | "alert";
export type SignalMode = "meanrev" | "trend" | "ivrich";

/** One leg's own market data, off the chain the spread was chosen from. */
export interface LegQuote {
  strike: number; code: string | null;
  delta: number | null; bid: number | null; ask: number | null;
  /** A decimal, unlike the percent OpenD reports. */
  iv: number | null; oi: number | null; volume: number | null;
}

export interface Spread {
  side: "put" | "call"; short: number; long: number; width: number; credit: number;
  max_loss: number; roi_pct?: number; pop_pct?: number; breakeven?: number;
  short_delta?: number; em_distance?: number;
  /** Absent on signals priced before the legs carried their own quotes. */
  short_leg?: LegQuote | null; long_leg?: LegQuote | null;
}

export interface Signal {
  ticker: string; spot: number; expiration: string; dte: number; modes: SignalMode[];
  direction: Direction; expected_move?: number; sd1_down?: number; sd1_up?: number;
  iv_pct: number; iv_rank: number | null; iv_rv?: number | null;
  indicators?: { rsi: number; pctb: number; adx: number; ema20: number; ema50: number; last_close: number };
  verdicts: Record<SignalMode, { direction: Direction; reason: string }>;
  spread: Spread | null;
}

export interface Decision {
  ticker: string; dte: number; modes: SignalMode[]; stage: Stage; passed: boolean;
  direction: Direction | null; reason: string; signal: Signal | null; edge: string[];
  alert_key: string | null; ai_verdict: string | null; ai_reason: string | null;
  alert_sent?: boolean; alert_error?: string | null;
  /** Gates switched off in settings. Absent on journal rows written before gates could be switched off. */
  skipped?: Stage[];
  /** Absent on journal rows written before confidence was recorded. */
  confidence?: { agree: number; of: number; win_rate: number | null; n: number | null };
}

export interface JournalRow { id: number; ts: string; decision: Decision }

export interface EngineStatus {
  running: boolean; state: string; engine_enabled: boolean; mode: string;
  market_hours_only: boolean;
  last_tick?: string | null; last_cycle?: string | null; last_error?: string | null;
  edge_built_at?: string | null; decisions?: number; alerts?: number;
  last_trigger?: "manual" | "schedule" | null;
  next_scan_at?: string | null;
}

export interface Settings {
  engine_enabled: boolean; mode: "manual" | "auto"; watchlist: string[]; modes: SignalMode[];
  dtes: number[]; interval_min: number; ticker_gap_sec: number; market_hours_only: boolean;
  edge_min_n: number; edge_min_expectancy: number; max_open_positions: number;
  max_deployed_risk: number; ai_enabled: boolean; ai_allow_caution: boolean;
  edge_enabled: boolean; risk_enabled: boolean; dedupe_enabled: boolean;
  alert_cooldown_hours: number;
  /* Credentials, so they need no shell session. A blank one leaves the environment in charge,
     which is what a headless run still reads. */
  ai_api_key: string; ai_api_endpoint: string; ai_model: string;
  telegram_bot_token: string; telegram_chat_id: string;
  tp_pct: number; sl_multiple: number; min_credit: number; bot_paused: boolean; bot_pause_reason: string;
}

/** app.py's SECRET_MASK: a saved secret reads back as this, and posting it back means "unchanged". */
export const SECRET_MASK = "********";

export interface Position {
  id: string; ticker: string; direction: Direction; short_strike: number; long_strike: number;
  width: number; credit: number; contracts: number; entry_date: string; expiry: string;
  mode: string; status: "open" | "closed"; close_date: string | null; close_pnl: number | null;
  entry_context: Record<string, unknown> | null;
}

export interface OpenPosition extends Position {
  spot: number | null; mtm_pnl: number | null; days_left: number; max_profit: number;
  risk: number; distance_pct: number | null; short_breached: boolean | null;
  profit_pct: number | null; profit_take_hit: boolean;
}

export interface PaperBook {
  open: OpenPosition[]; closed: Position[];
  stats: { total_pnl: number; wins: number; losses: number; win_rate: number;
           open_count: number; deployed_risk: number; risk_cap: number };
}

/** Real moomoo account, read-only. */
export interface Account {
  net_value: number; cash: number; buying_power: number; unrealized_pl: number; open_count: number; currency: string;
}

export type LiveState = "entering" | "open" | "closing" | "closed" | "entry_cancelled";

export interface LiveTrade {
  id: string; ticker: string; direction: Direction; expiry: string; short_strike: number; long_strike: number;
  width: number; contracts: number; planned_credit: number; state: LiveState; credit: number | null;
  tp_order_id: string | null; tp_tif: string | null; sl_hits: number; close_price: number | null;
  exit_reason: "tp" | "sl" | "ai" | "expiry" | "manual" | null; close_debit: number | null; fees: number;
  pnl: number | null; ai_reason: string | null; last_ai_check: string | null;
  opened_at: string; filled_at: string | null; closed_at: string | null;
}

export interface OrderEvent {
  id: number; ts: string; trade_id: string | null; action: string; order_id: string | null;
  price: number | null; status: string; reason: string | null;
}

export interface BotStatus {
  mode: "manual" | "auto"; paused: boolean; pause_reason: string;
  monitor: { state: string; last_ok: string | null; last_error: string | null };
  net_pnl: number; slots: number; next_slot_at: number;
  active: LiveTrade[]; closed: LiveTrade[]; marks: Record<string, number>; events: OrderEvent[];
}

export interface PreflightCheck { name: string; ok: boolean; detail: string }

/** One entry of cs_notify.AI_PROVIDERS: an endpoint the AI review may point at, and its models. */
export interface AiProvider {
  id: string; label: string; url: string; auth: "key" | "bearer";
  models: { id: string; label: string }[];
}

export interface SizePreview {
  ticker: string; contracts: number; trade_risk: number; credit_total: number;
  deployed_before: number; deployed_after: number; cap: number;
  open_positions: number; max_open_positions: number; ok: boolean; reason: string;
}

export interface PayoffGrid {
  spots: number[]; days: number[]; pnl: number[][]; breakeven: number;
  max_profit: number; max_loss: number; spot: number;
  /** The vol the grid was priced at, so a caller can bump it to difference vega. */
  sigma: number;
}

export interface IvSurface {
  ticker: string; spot: number; expiries: string[]; dtes: number[]; strikes: number[];
  iv: (number | null)[][]; min_iv: number | null; max_iv: number | null;
}

export interface EdgeCell {
  mode: SignalMode; dte: number; bucket: "low" | "mid" | "high" | "unranked";
  n: number; expectancy: number; win_rate: number | null; validated: boolean; passes: boolean;
}

export interface Learn {
  days: number; decisions: number; errors: number;
  funnel: { stage: Stage; reached: number; stopped: number }[];
  edge: EdgeCell[]; edge_built_at: string | null; min_n: number;
  paper: { mode: string; paper_n: number; paper_win_rate: number; paper_expectancy: number;
           paper_total: number; backtest_n: number; backtest_expectancy: number | null }[];
}

export interface BacktestStats {
  n: number; win_rate?: number; avg_win?: number; avg_loss?: number; expectancy?: number;
  total_pnl?: number; profit_factor?: number | null; max_drawdown?: number;
}

export interface BacktestTrade {
  ticker: string; entry: string; expiry: string; dte: number; mode: string; direction: Direction;
  iv_rank: number | null; short: number; long: number; width: number; credit: number;
  max_loss: number; contracts: number; pnl: number; win: boolean;
}

// Server-sent events from /api/signal/stream and /api/backtest/stream.
export interface StreamLog { step: string; msg: string }
export interface SignalStreamResult { data: Signal }
export interface BacktestStreamResult { data: { stats: BacktestStats; trades: BacktestTrade[] } }
export interface StreamAbort { msg: string }

export interface AiVerdict { verdict: "CONFIRM" | "CAUTION" | "AVOID"; reason: string; raw: string }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${resp.status}`, resp.status);
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  engineStatus: () => request<EngineStatus>("/api/engine/status"),
  scanNow: () => post<{ started: boolean }>("/api/scan/now"),
  scanLatest: () => request<JournalRow[]>("/api/scan/latest"),
  clearScan: () => post<{ cleared: number }>("/api/scan/clear"),
  journal: (limit = 100) => request<JournalRow[]>(`/api/journal?limit=${limit}`),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (updates: Partial<Settings> & { confirm?: string }) => post<Settings>("/api/settings", updates),
  aiProviders: () => request<AiProvider[]>("/api/ai/providers"),
  bot: () => request<BotStatus>("/api/bot"),
  botPreflight: () => request<{ checks: PreflightCheck[]; ready: boolean }>("/api/bot/preflight"),
  stopBot: () => post<BotStatus>("/api/bot/stop"),
  resumeBot: () => post<BotStatus>("/api/bot/resume"),
  closeAllBot: () => post<{ closing: number }>("/api/bot/close-all", { confirm: "CLOSE" }),
  resetSettings: () => post<Settings>("/api/settings/reset"),
  signal: (ticker: string, dte: number, modes: SignalMode[]) =>
    request<Signal>(`/api/signal?ticker=${encodeURIComponent(ticker)}&dte=${dte}&modes=${modes.join(",")}`),
  signalStreamUrl: (ticker: string, dte: number, modes: SignalMode[]) =>
    `/api/signal/stream?ticker=${encodeURIComponent(ticker)}&dte=${dte}&modes=${modes.join(",")}`,
  backtestStreamUrl: (ticker: string, dte: number, modes: SignalMode[]) =>
    `/api/backtest/stream?ticker=${encodeURIComponent(ticker)}&dte=${dte}&modes=${modes.join(",")}`,
  ivSurface: (ticker: string, refresh = false) =>
    request<IvSurface>(`/api/iv-surface?ticker=${encodeURIComponent(ticker)}${refresh ? "&refresh=1" : ""}`),
  payoff: (body: { direction: Direction; short_strike: number; long_strike: number; credit: number;
                   contracts?: number; expiry?: string; days_left?: number; spot?: number;
                   sigma?: number; ticker?: string }) => post<PayoffGrid>("/api/payoff", body),
  paper: () => request<PaperBook>("/api/paper"),
  account: () => request<Account>("/api/account"),
  openPaper: (body: { ticker: string; direction: Direction; short_strike: number; long_strike: number;
                      width: number; credit: number; contracts: number; expiry: string; mode: string;
                      entry_context?: Record<string, unknown> }) => post<Position>("/api/paper/open", body),
  closePaper: (id: string) => post<Position>("/api/paper/close", { id }),
  sizePreview: (ticker: string, signal: Signal) => post<SizePreview>("/api/size/preview", { ticker, signal }),
  aiReview: (ticker: string, signal: Signal) => post<AiVerdict>("/api/ai/confirm", { ticker, signal }),
  learn: (days = 7) => request<Learn>(`/api/learn?days=${days}`),
};
