#!/usr/bin/env bash
# One-time setup for Theta Desk. Safe to re-run; it only does what is missing.
#
#   ./setup.sh           install everything
#   ./setup.sh --force   rebuild the virtualenv and node_modules from scratch
#
# Afterwards, ./run.sh starts the desk.
set -euo pipefail
cd "$(dirname "$0")"

FORCE="${1:-}"
PY_BIN="${PYTHON:-python3.11}"
VENV="backend/.venv"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
die()  { printf '\033[31m!!  %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- requirements
say "Checking requirements"

command -v "$PY_BIN" >/dev/null 2>&1 || die \
  "$PY_BIN not found. Install Python 3.11, or point PYTHON at it: PYTHON=/path/to/python3.11 ./setup.sh"
PY_VER="$("$PY_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
[ "$PY_VER" = "3.11" ] || warn "Python $PY_VER found; this project is tested on 3.11."
echo "    python  $PY_VER  ($(command -v "$PY_BIN"))"

command -v node >/dev/null 2>&1 || die "node not found. Install Node 20 or newer."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || warn "Node $(node -v) found; this project expects 20 or newer."
echo "    node    $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found. It ships with Node."
echo "    npm     $(npm -v)"

# ---------------------------------------------------------------------- python
if [ "$FORCE" = "--force" ] && [ -d "$VENV" ]; then
  say "Removing the existing virtualenv (--force)"
  rm -rf "$VENV"
fi

if [ ! -x "$VENV/bin/python" ]; then
  say "Creating $VENV"
  "$PY_BIN" -m venv "$VENV"
fi

say "Installing backend dependencies (app, tests, MCP server)"
# setuptools too: the one bundled with a fresh venv has a known advisory
# (PYSEC-2026-3447), and every clone would otherwise start out with it.
"$VENV/bin/python" -m pip install -q --upgrade pip 'setuptools>=83'
"$VENV/bin/python" -m pip install -q -e "backend[dev,mcp]"

# -------------------------------------------------------------------- frontend
if [ "$FORCE" = "--force" ] && [ -d frontend/node_modules ]; then
  say "Removing frontend/node_modules (--force)"
  rm -rf frontend/node_modules
fi

say "Installing frontend dependencies"
(cd frontend && npm ci --no-audit --no-fund)

# ------------------------------------------------------------------------ .env
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  chmod 600 .env          # it will hold credentials
  echo "    Fill in Telegram and AI credentials when you want alerts and trade review."
else
  echo
  echo "    .env already exists; leaving its contents alone."
  chmod 600 .env          # but never leave credentials world-readable
fi

# ----------------------------------------------------------------------- check
say "Verifying the install"
"$VENV/bin/python" -c "import theta, flask, pandas, futu; print('    backend imports OK')"
"$VENV/bin/python" -c "from theta import mcp_server; print('    MCP server imports OK')"
[ -d frontend/node_modules ] && echo "    frontend dependencies OK"

say "Setup complete"
cat <<'MSG'
    Start everything with:   ./run.sh
    Hot-reloading UI with:   ./run.sh --dev

    Live data needs moomoo OpenD running and logged in.
MSG
