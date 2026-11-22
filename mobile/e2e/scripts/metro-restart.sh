#!/usr/bin/env bash
# Restarts only the E2E Metro server (CI mode has no file watcher, so source
# edits are picked up on restart). Development convenience; run.sh does not need it.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
if [ -f "$RUN_DIR/metro.pid" ]; then
  PID="$(cat "$RUN_DIR/metro.pid")"
  if ps -p "$PID" -o command= 2>/dev/null | grep -q "expo start --port $METRO_PORT"; then pkill -P "$PID" 2>/dev/null || true; kill "$PID" 2>/dev/null || true; fi
fi
for pid in $(lsof -tiTCP:"$METRO_PORT" -sTCP:LISTEN -n -P 2>/dev/null || true); do
  ps -p "$pid" -o command= | grep -q "expo" && kill "$pid" 2>/dev/null || true
done
sleep 2
(
  cd "$MOBILE_DIR"
  EXPO_PUBLIC_API_URL="http://127.0.0.1:$API_PORT" EXPO_NO_TELEMETRY=1 CI=1 NODE_OPTIONS=--dns-result-order=ipv4first \
    nohup npx expo start --port "$METRO_PORT" --host localhost --clear >"$RUN_DIR/metro.log" 2>&1 &
  echo $! > "$RUN_DIR/metro.pid"
)
for _ in $(seq 1 60); do
  [ "$(curl -fsS "http://localhost:$METRO_PORT/status" 2>/dev/null || true)" = "packager-status:running" ] && break
  sleep 2
done
echo "e2e: Metro restarted"
