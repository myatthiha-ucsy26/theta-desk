#!/usr/bin/env bash
# One command to set up and start Theta Desk.
#
#   ./run.sh                 set up (first run) -> test -> build UI -> serve
#   ./run.sh --skip-tests    skip the test gate
#   PORT=8000 ./run.sh       serve on another port
#
# OPEND_HOST / OPEND_PORT (default 127.0.0.1:11111) point at moomoo OpenD.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5057}"
OPEND_HOST="${OPEND_HOST:-127.0.0.1}"
OPEND_PORT="${OPEND_PORT:-11111}"
URL="http://127.0.0.1:${PORT}"
PY="backend/.venv/bin/python"

# 1. Python environment (first run only; .venv is git-ignored)
if [ ! -x "$PY" ]; then
  echo "==> Creating backend/.venv and installing dependencies..."
  python3.11 -m venv backend/.venv
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -q -e "backend[dev]"
fi

# 2. Frontend dependencies
if [ ! -d frontend/node_modules ]; then
  echo "==> Installing frontend dependencies..."
  (cd frontend && npm ci --no-audit --no-fund)
fi

# 3. OpenD reachability (a warning, not a failure: the UI and paper book work without it)
if (exec 3<>"/dev/tcp/${OPEND_HOST}/${OPEND_PORT}") 2>/dev/null; then
  echo "==> OpenD reachable at ${OPEND_HOST}:${OPEND_PORT}"
else
  echo "!!  OpenD NOT reachable at ${OPEND_HOST}:${OPEND_PORT} — start moomoo OpenD, or live data will error."
fi

# 4. Test gate
if [ "${1:-}" != "--skip-tests" ]; then
  echo "==> Running backend tests..."
  (cd backend && .venv/bin/python -m pytest -q)
  echo "==> Running frontend tests..."
  (cd frontend && npm test --silent)
fi

# 5. Build the UI when the build is missing or older than its sources
if [ ! -f frontend/dist/index.html ] || \
   [ -n "$(find frontend/src frontend/index.html frontend/package.json frontend/vite.config.ts \
           -newer frontend/dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> Building UI..."
  (cd frontend && npm run build)
fi

# 6. Serve, and open a browser once it answers
echo "==> Theta Desk on ${URL}  (Ctrl-C to stop)"
(
  for _ in $(seq 1 40); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then exec 3>&-; break; fi
    sleep 0.25
  done
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
) &
cd backend && exec env PORT="$PORT" .venv/bin/python -m theta
