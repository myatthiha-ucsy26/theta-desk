# Theta Desk

A local desk for selling credit spreads on US equity options. It scans a
watchlist against a fixed set of gates, shows what passed and why, keeps a paper
book, and — once you switch it to auto — places and manages real orders through
moomoo OpenD.

Everything runs on your own machine. There is no hosted component and no account
system; the only things it talks to are OpenD, Telegram and the AI review
endpoint you configure.

## Requirements

- Python 3.11
- Node 20+
- [moomoo OpenD](https://www.moomoo.com/download/OpenAPI) running and logged in,
  with US options data. Without it the UI and the paper book still work, but
  anything needing live quotes returns an error.

## Quick start

```bash
git clone <this repo> theta-desk
cd theta-desk
./setup.sh      # once: virtualenv, dependencies, .env
./run.sh        # every time: tests, UI build, then serve
```

`setup.sh` checks you have Python 3.11 and Node 20+, creates `backend/.venv`,
installs the backend (app, tests and MCP server) and the frontend, and copies
`.env.example` to `.env` if you have no `.env` yet. Re-running it is safe;
`./setup.sh --force` rebuilds the virtualenv and `node_modules` from scratch.

`run.sh` runs both test suites, builds the UI if it is stale, then starts the
desk on <http://127.0.0.1:5057> and the MCP market-data server on
<http://127.0.0.1:5058/mcp>. Ctrl-C stops both.

| | |
|---|---|
| `./run.sh --dev` | also run Vite on 5173 with hot reload |
| `./run.sh --skip-tests` | skip the test gate |
| `./run.sh --no-mcp` | do not start the MCP server |
| `./run.sh --no-open` | do not open a browser |
| `PORT=8000 ./run.sh` | serve the desk on another port (`MCP_PORT` likewise) |

It refuses to start if a port it needs is already taken, rather than failing
halfway.

## Layout

```
backend/     Python: market data, gates, engine, broker, HTTP API
frontend/    React + Vite desk UI
docs/        architecture notes and the strategy spec
```

`docs/architecture.md` explains how the backend is grouped and why.

## Working on it

`./run.sh --dev` is the loop to use: the API on 5057, and Vite on 5173 with hot
reload proxying `/api` to it. Open 5173, not 5057.

To run the suites on their own:

```bash
cd backend && .venv/bin/python -m pytest
cd frontend && npm test
```

The engine and the live bot are off by default. `engine_enabled` starts
scanning; switching `mode` to `auto` is what allows real orders, and that switch
requires typing `LIVE` and passing a pre-flight check.

## Configuration

Copy `.env.example` to `.env`. Anything already exported in your shell wins over
the file, and credentials saved in the Settings screen win over both.

| Variable | Meaning |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerts |
| `AI_API_KEY`, `AI_API_ENDPOINT`, `AI_MODEL` | AI trade review |
| `OPEND_HOST`, `OPEND_PORT` | OpenD gateway (default `127.0.0.1:11111`) |
| `PORT` | Server port (default `5057`) |
| `CS_DB_PATH` | Database file (default `data/engine.db`) |

## Market data over MCP

The same OpenD quote path is exposed as an MCP server, so quotes, expirations
and option chains can be queried outside the dashboard. It is read-only and
places no orders. `setup.sh` installs it.

`run.sh` serves it over HTTP at <http://127.0.0.1:5058/mcp>:

```json
{ "moomoo": { "type": "http", "url": "http://127.0.0.1:5058/mcp" } }
```

Clients that would rather launch the server themselves can use stdio instead,
which needs nothing running:

```json
{
  "moomoo": {
    "type": "stdio",
    "command": "/absolute/path/to/theta-desk/backend/.venv/bin/python",
    "args": ["-m", "theta.mcp_server"]
  }
}
```

## Data

`data/engine.db` holds positions, paper trades, settings, the journal and the
edge table. `klines_cache/` and `iv_history/` are caches rebuilt from OpenD.
None of it is tracked; delete any of it and it comes back.

## Risk

This places real orders when you tell it to. Paper mode is the default for a
reason — read `docs/credit_spread_spec.md` and run the backtest before trusting
it with money.
