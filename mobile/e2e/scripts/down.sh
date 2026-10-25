#!/usr/bin/env bash
# Removes everything the current E2E run created: Metro, the containers and the
# volumes of the bodytrack-e2e compose project (which holds the E2E database and
# every account made by the runs), and the run directory.
# It first proves the stack is the one this run created; otherwise it refuses.
# The dedicated simulator is kept (reused by the next run); pass --simulator to
# delete it too.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ -f "$RUN_DIR/compose.env" ] || die "refusing: no run recorded in $RUN_DIR (nothing to clean, or it was not created by up.sh)"
verify_identity

if [ -f "$RUN_DIR/metro.pid" ]; then
  PID="$(cat "$RUN_DIR/metro.pid")"
  # Only stop the process if it is still our Metro on our port.
  if ps -p "$PID" -o command= 2>/dev/null | grep -q "expo start --port $METRO_PORT"; then
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
  fi
fi
# Metro's node child may outlive the npx wrapper; match it by our unique port.
for pid in $(lsof -tiTCP:"$METRO_PORT" -sTCP:LISTEN -n -P 2>/dev/null || true); do
  ps -p "$pid" -o command= | grep -q "expo" && kill "$pid" 2>/dev/null || true
done

compose down -v --remove-orphans >"$RUN_DIR/compose-down.log" 2>&1 || { tail -5 "$RUN_DIR/compose-down.log"; die "compose down failed"; }

if [ "${1:-}" = "--simulator" ]; then
  UDID="$(sim_udid)"
  if [ -n "$UDID" ] && xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME"; then
    xcrun simctl shutdown "$UDID" 2>/dev/null || true
    xcrun simctl delete "$UDID"
    rm -f "$E2E_HOME/sim-udid"
  fi
fi
rm -rf "${RUN_DIR:?}"
echo "e2e: cleaned up run (stack, volumes, Metro, run directory)"
