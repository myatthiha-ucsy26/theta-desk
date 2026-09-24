#!/usr/bin/env bash
# Start the demo desk: every screen filled from a simulated book, labelled DEMO throughout.
#
#   ./demo.sh               build the demo and serve it on http://127.0.0.1:5174
#   ./demo.sh --no-open     do not open a browser
#
# Needs no backend, no OpenD and no moomoo login, and cannot reach them: every figure is
# generated in the browser and every change is refused. The real desk (./run.sh, :5057) is a
# separate build and is not touched. Ctrl-C stops it.
set -euo pipefail
cd "$(dirname "$0")/frontend"

PORT="${DEMO_PORT:-5174}"
URL="http://127.0.0.1:${PORT}/"
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *)         echo "Unknown option: $arg  (try --help)" >&2; exit 2 ;;
  esac
done

[ -d node_modules ] || npm install

printf '\n\033[1m==> Building the demo desk\033[0m\n'
VITE_DEMO=1 npx vite build --outDir dist-demo --emptyOutDir

printf '\n\033[1m==> Demo desk on %s  (simulated data — Ctrl-C to stop)\033[0m\n' "$URL"
if [ "$OPEN" = 1 ]; then
  (sleep 2; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true) &
fi
exec npx vite preview --outDir dist-demo --host 127.0.0.1 --port "$PORT" --strictPort
