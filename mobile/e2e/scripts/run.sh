#!/usr/bin/env bash
# Runs the smoke flow once against the running E2E stack, from a controlled
# initial state: a brand-new account and a freshly installed Expo Go with an
# emptied keychain on the dedicated simulator, so no earlier session can leak in.
#
#   e2e/scripts/up.sh && e2e/scripts/run.sh [flow.yaml]; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/smoke-workout.yaml}"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
UDID="$(sim_udid)"; [ -n "$UDID" ] || die "no dedicated simulator recorded"
xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME" || die "recorded simulator is not $SIM_NAME; refusing"
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "E2E backend is not answering"

# ── fresh account for this run ──
N="$(( $(cat "$RUN_DIR/runs" 2>/dev/null || echo 0) + 1 ))"; echo "$N" > "$RUN_DIR/runs"
SUFFIX="$(openssl rand -hex 3)"
EMAIL="e2e-$(run_id)-$N-$SUFFIX@example.com"; USERNAME="e2e_${N}_$SUFFIX"; PASSWORD="Aa1-$(openssl rand -hex 10)"
umask 077
{ echo "E2E_EMAIL=$EMAIL"; echo "E2E_USERNAME=$USERNAME"; echo "E2E_PASSWORD=$PASSWORD"; } > "$RUN_DIR/account-$N.env"
python3 - "$EMAIL" "$USERNAME" "$PASSWORD" <<'PY' | curl -fsS -o /dev/null -X POST "http://127.0.0.1:$API_PORT/api/v1/auth/register" -H 'Content-Type: application/json' --data-binary @-
import json, sys
print(json.dumps({"email": sys.argv[1], "username": sys.argv[2], "password": sys.argv[3], "first_name": "E2E"}))
PY
echo "e2e: run $N with a new temporary account (credentials in $RUN_DIR/account-$N.env, mode 600)"

# ── controlled device state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/run-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/run-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" -e E2E_EMAIL="$EMAIL" -e E2E_PASSWORD="$PASSWORD" \
  --test-output-dir "$OUT" 2>&1 | sed "s/$PASSWORD/<password>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
exit "$STATUS"
