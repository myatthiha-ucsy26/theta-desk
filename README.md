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
cp .env.example .env     # optional: Telegram and AI review credentials
./run.sh
```

`run.sh` creates the virtualenv, installs both dependency sets, runs both test
suites, builds the UI and serves it at <http://127.0.0.1:5057>.

Useful variants:

```bash
./run.sh --skip-tests    # skip the test gate
PORT=8000 ./run.sh       # serve on another port
```

## Layout

```
backend/     Python: market data, gates, engine, broker, HTTP API
frontend/    React + Vite desk UI
docs/        architecture notes and the strategy spec
```

`docs/architecture.md` explains how the backend is grouped and why.

## Working on it

```bash
# backend
cd backend && .venv/bin/python -m pytest

# frontend: unit tests, and a dev server that proxies /api to :5057
cd frontend && npm test
cd frontend && npm run dev
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
places no orders.

```bash
cd backend && .venv/bin/python -m pip install -e ".[mcp]"
```

Then point your MCP client at:

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
