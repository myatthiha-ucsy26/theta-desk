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

`backend/theta/` is one package, grouped by what each part talks to.

| Package | Responsibility | Talks to |
|---|---|---|
| `config` | Reads `.env` into the environment at startup | filesystem |
| `context` | Holds per-process state: db path, broker, runner, monitor | — |
| `market/` | Quotes, klines, option chains, IV, pricing, rate limiting | OpenD |
| `broker/` | Orders, account, position management, settlement | OpenD |
| `storage/` | SQLite: positions, paper trades, settings, journal, edge table | disk |
| `engine/` | Gate pipeline, scan loop, position monitor, auto-trade | market, broker, storage |
| `notify` | Telegram alerts, AI trade review | HTTP |
| `research/` | Backtest and aggregate statistics | market |
| `api/` | Flask blueprints | everything above |
| `mcp_server` | Read-only market data over MCP | market |

Dependencies point downward only. `market/` and `storage/` know nothing about
`engine/`; `engine/` knows nothing about `api/`.

### Application state

The server has four pieces of mutable process state: the database path, the
broker client, the scan runner and the position monitor. These live in an
`AppContext` built once in `create_app()` and stored on `app.extensions`.

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

## Data

SQLite, at `data/engine.db` by default and overridable with `CS_DB_PATH`. It
holds open positions, paper trades, validated settings, the alert journal and
the conditional edge table.

Klines and IV history are cached to disk under `klines_cache/` and `iv_history/`.
Both are derived from OpenD and safe to delete; they are not source and are not
tracked.

## Running it

`./run.sh` creates the virtualenv, installs both dependency sets, runs the test
suites, builds the UI and starts the server. See the README for the short
version.

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
