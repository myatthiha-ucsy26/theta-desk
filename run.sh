#!/usr/bin/env bash
# Start Theta Desk: the API and UI, and the MCP market-data server beside it.
#
#   ./run.sh                 build the UI, then serve everything
#   ./run.sh --dev           also run Vite on 5173 with hot reload
#   ./run.sh --skip-tests    skip the test gate
#   ./run.sh --no-mcp        do not start the MCP server
#   ./run.sh --no-open       do not open a browser
#
# Ports:  PORT=5057 the desk · MCP_PORT=5058 the MCP server · 5173 Vite (--dev)
# OpenD:  OPEND_HOST / OPEND_PORT, default 127.0.0.1:11111
#
# Run ./setup.sh first. Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5057}"
MCP_PORT="${MCP_PORT:-5058}"
VITE_PORT="${VITE_PORT:-5173}"
OPEND_HOST="${OPEND_HOST:-127.0.0.1}"
OPEND_PORT="${OPEND_PORT:-11111}"
URL="http://127.0.0.1:${PORT}"
PY="backend/.venv/bin/python"

DEV=0; SKIP_TESTS=0; WITH_MCP=1; OPEN=1
for arg in "$@"; do
  case "$arg" in
    --dev)        DEV=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --no-mcp)     WITH_MCP=0 ;;
    --no-open)    OPEN=0 ;;
    -h|--help)    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *)            echo "Unknown option: $arg  (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
die()  { printf '\033[31m!!  %s\033[0m\n' "$1" >&2; exit 1; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# ------------------------------------------------------------- shut down clean
# Everything is started in the background and waited on, so a signal reaches
# this script rather than being swallowed by a foreground child, and the trap
# can take the others down with it.
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  [ ${#PIDS[@]} -eq 0 ] && return 0
  kill "${PIDS[@]}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    alive=0
    for pid in "${PIDS[@]}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" -eq 0 ] && return 0
    sleep 0.25
  done
  kill -9 "${PIDS[@]}" 2>/dev/null || true   # whatever would not go quietly
}
trap cleanup EXIT INT TERM

# -------------------------------------------------------------------- preflight
[ -x "$PY" ] || die "No virtualenv. Run ./setup.sh first."
[ -d frontend/node_modules ] || die "Frontend dependencies missing. Run ./setup.sh first."

check_port() {
  port_busy "$1" && die "Port $1 is already in use, and $2 needs it. Stop what is on it, or set $3."
  return 0
}
check_port "$PORT" "the desk" "PORT"
if [ "$WITH_MCP" -eq 1 ]; then check_port "$MCP_PORT" "the MCP server" "MCP_PORT"; fi
if [ "$DEV" -eq 1 ];     then check_port "$VITE_PORT" "Vite" "VITE_PORT"; fi

if (exec 3<>"/dev/tcp/${OPEND_HOST}/${OPEND_PORT}") 2>/dev/null; then
  echo "==> OpenD reachable at ${OPEND_HOST}:${OPEND_PORT}"
else
  warn "OpenD not reachable at ${OPEND_HOST}:${OPEND_PORT} — the UI and paper book work, live data will error."
fi

# ------------------------------------------------------------------- test gate
if [ "$SKIP_TESTS" -eq 0 ]; then
  say "Backend tests"
  (cd backend && .venv/bin/python -m pytest -q)
  say "Frontend tests"
  (cd frontend && npm test --silent)
fi

# -------------------------------------------------------------------- build UI
if [ "$DEV" -eq 0 ]; then
  if [ ! -f frontend/dist/index.html ] || \
     [ -n "$(find frontend/src frontend/index.html frontend/package.json frontend/vite.config.ts \
             -newer frontend/dist/index.html -print -quit 2>/dev/null)" ]; then
    say "Building the UI"
    (cd frontend && npm run build)
  fi
fi

# ------------------------------------------------------------------ MCP server
if [ "$WITH_MCP" -eq 1 ]; then
  say "Starting the MCP market-data server on http://127.0.0.1:${MCP_PORT}/mcp"
  (cd backend && exec .venv/bin/python -m theta.mcp_server --http --port "$MCP_PORT") &
  PIDS+=($!)
fi

# ----------------------------------------------------------------- Vite (--dev)
if [ "$DEV" -eq 1 ]; then
  say "Starting Vite on http://127.0.0.1:${VITE_PORT} (hot reload; it proxies /api to ${PORT})"
  # Vite listens on ::1 unless told otherwise, and then 127.0.0.1 refuses.
  (cd frontend && exec npm run dev -- --port "$VITE_PORT" --host 127.0.0.1 --strictPort) &
  PIDS+=($!)
  URL="http://127.0.0.1:${VITE_PORT}"
fi

# --------------------------------------------------------- open once it answers
if [ "$OPEN" -eq 1 ]; then
  (
    for _ in $(seq 1 60); do
      if port_busy "${URL##*:}"; then break; fi
      sleep 0.25
    done
    if command -v open >/dev/null 2>&1; then open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
  ) &
  PIDS+=($!)
fi

# ---------------------------------------------------------------------- serve
say "Theta Desk on ${URL}   (Ctrl-C stops everything)"
(cd backend && exec env PORT="$PORT" .venv/bin/python -m theta) &
DESK=$!
PIDS+=($DESK)

# Waiting (rather than exec-ing) keeps this shell alive to run the trap. If the
# desk stops on its own, fall through and take the rest down with it.
wait "$DESK"
