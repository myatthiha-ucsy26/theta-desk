# Architecture

Theta Desk is a local desk for selling credit spreads on US equity options. It
scans a watchlist against a fixed set of gates, shows what passed and why, keeps
a paper book, and — in auto mode — places and manages real orders through moomoo
OpenD.

Everything runs on one machine. There is no hosted component, no account system
and no outbound service other than OpenD, Telegram and the AI review endpoint.

## Layout

```
theta-desk/
├── backend/          Python: market data, gates, engine, broker, HTTP API
├── frontend/         React + Vite desk UI, built to static assets
└── docs/             this file and the strategy spec
```

The Flask server serves the built frontend at `/`, so a clone builds into a
single process on one port.

## Backend

`backend/theta/` is one package. The modules at its root are the shared
foundation; the subpackages are grouped by what each one talks to.

| Module | Responsibility | Talks to |
|---|---|---|
| `config` | Reads `.env` into the environment at startup | filesystem |
| `paths` | Where the database and caches live | — |
| `stats` | Percentile rank; the one definition of "rank" (20-day realised vol, ranked over a year) | — |
| `strategy` | Indicators, gate verdicts, spread construction | — |
| `signals` | A live signal: market data through the gates | market, strategy |
| `paper` | Marking a book to model | market |
| `credentials` | Which setting stands in for which environment variable | — |
| `context` | Per-process state: database, broker, threads | storage |
| `services` | Wires the engine and monitor to the outside world | most of the above |
| `notify` | Telegram alerts, AI trade review | HTTP |
| `mcp_server` | Read-only market data over MCP | market |

| Package | Responsibility | Talks to |
|---|---|---|
| `market/` | Quotes, klines, option chains, IV, pricing, rate limiting | OpenD |
| `storage/` | SQLite: positions, paper trades, settings, journal, edge table | disk |
| `broker/` | Orders, account, position management, settlement | OpenD |
| `broker/paper.py` | Simulates fills from live quotes; sends nothing | market, storage |
| `engine/` | Gate pipeline, scan loop, position monitor, auto-trade | market, broker, storage |
| `research/` | Backtest and aggregate statistics | market, strategy |
| `api/` | Flask blueprints | everything above |

Dependencies point downward only. `strategy` and `stats` are pure and import
nothing of ours; `market/` and `storage/` know nothing about `engine/`; nothing
below `api/` knows that Flask exists.

### Application state

The server has four pieces of mutable process state: the database path, the
broker client, the scan runner and the position monitor. These live in an
`AppContext` built once and stored on `app.extensions`, which blueprints reach
through `ctx()`.

Blueprints reach it through `current_app`. Tests construct one directly:

```python
app = create_app(AppContext(db_path=tmp_path / "app.db", broker=FakeBroker()))
```

This is the one deliberate departure from a straight port of the original
single-file server, which kept the same four values as module globals and had
tests reassign them. Splitting the routes across blueprints left no single
module to reassign, and passing the state in is clearer besides.

### API surface

Blueprints map one-to-one onto screens in the UI.

| Blueprint | Routes |
|---|---|
| `signal` | `/api/signal`, `/api/signal/stream` |
| `paper` | `/api/paper/*`, `/api/account`, `/api/size/preview` |
| `engine` | `/api/engine/status`, `/api/scan/*`, `/api/journal` |
| `bot` | `/api/bot/*` |
| `surfaces` | `/api/payoff`, `/api/iv-surface` |
| `settings` | `/api/settings*`, `/api/ai/*`, `/api/learn`, `/api/alert/telegram` |
| `web` | `/`, `/assets/<path>` |

`api/streams.py` holds the two server-sent-event generators. Only the narration
lives there; the computation stays in `signals` and `research`.

Long-running work streams over server-sent events rather than blocking a
request: scans and backtests both report progress that way.

## Frontend

React 19 and Vite, with Tailwind for layout and Three.js for the IV and payoff
surfaces. `src/lib/` holds the logic — API client, gate funnel, greeks, theme,
time formatting — kept free of React so it can be tested directly. `src/screens/`
and `src/components/` render it.

Two layout templates ship: Broadsheet and Neural Quant. The choice is stored per
browser and switched in Settings.

In development `npm run dev` proxies `/api` to the Flask server on 5057. In
production `npm run build` emits `dist/`, which Flask serves.

## Accounts

The bot trades through a paper account or the live one, chosen by the
`account_mode` setting. `PaperBroker` implements the same interface as the real
broker, so the engine, the monitor and the autotrade rules run unchanged in both
— which is the only reason paper mode says anything about live mode.

Every position and bot trade carries an `account`, and the queries that could
total simulated and real money together require it as a keyword argument.
`docs/paper-and-live-accounts.md` has the detail, including why leaving the live
account with an open position is refused.

## Data

SQLite, at `data/engine.db` by default and overridable with `CS_DB_PATH`. It
holds open positions, bot trades, simulated orders, validated settings, the
alert journal and the conditional edge table.

`init()` creates missing tables and then adds missing columns: `CREATE TABLE IF
NOT EXISTS` does nothing to a table that already exists, so a schema change
needs the second step.

Klines and IV history are cached to disk under `klines_cache/` and `iv_history/`.
Both are derived from OpenD and safe to delete; they are not source and are not
tracked.

The kline cache holds completed bars only. Today's bar is still forming, so it is
never written or returned. A request that reaches before the cache's first bar
refetches from the earlier date, so a short request (the 120 days the paper book
marks from) can never shrink the five years the edge table needs. A cache
refreshed today counts as current, which stops a pre-market scan from going back
to OpenD on every call.

`iv_history/` is a record of ATM IV. Nothing gates on it: the live `ivrich` gate
and the edge table both rank realised vol, because that is the only history
available to backtest on.

### The edge table

The runner rebuilds the edge table from a pooled backtest every 24 hours, when a
configured DTE has no cells, or when the exit rules change. The backtest replays
the bot's own trade: a 5-wide spread, closed at the `tp_pct` take profit or the
`sl_multiple` stop, marked at each daily close, otherwise held to expiry. Every
cell records the rules it was measured under (`runner.exit_rules`). A table
stored before rules were recorded fails that check and is rebuilt.

### The risk gate

`runner.open_risk` gives the risk gate everything open in the active account:
notebook positions plus the bot's entering, open and closing spreads. It is
re-read before every scan in a cycle, so an entry the bot made earlier in the
same cycle counts against the position and deployed-risk caps.

## Running it

`setup.sh` installs; `run.sh` runs. The split is so that the everyday path does
not re-check a toolchain that has not changed.

`run.sh` starts two processes: the desk on 5057 and the MCP server on 5058. Both
are background children of the script, which then waits on the desk. Waiting
rather than exec-ing is what lets a signal reach the script so its trap can take
the other one down; exec-ing would leave the MCP server orphaned.

The desk itself is `python -m theta`, which loads `.env`, opens the database,
starts the engine and monitor threads and serves the app. Importing `theta.api`
never starts a thread, so the tests get an app without one.

OpenD must be running and logged in for anything that touches live data. Without
it the UI still loads and the paper book still works; live endpoints return an
error explaining what is missing.

## Testing

`backend/tests/` mirrors the package layout. Tests never reach OpenD: market
data is faked at the module boundary, and the broker has a fake implementation
in `tests/fakes.py` that records orders instead of sending them.

Frontend logic in `src/lib/` is tested directly with Vitest; components are
tested through Testing Library.

Both suites run from `run.sh` and must pass before the server starts.
