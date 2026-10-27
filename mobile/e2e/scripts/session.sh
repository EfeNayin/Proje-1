#!/usr/bin/env bash
# Runs the account-switching flow once against the running E2E stack: two brand-new
# temporary accounts (A has private data: one finished and one unfinished workout),
# a freshly installed Expo Go with an emptied keychain at the start, and then NO
# storage or keychain reset while the flow signs A out, relaunches the app and
# signs B in. Same isolation as run.sh; only the flow and the accounts differ.
#
#   e2e/scripts/up.sh && e2e/scripts/session.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/session-switch.yaml}"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
UDID="$(sim_udid)"; [ -n "$UDID" ] || die "no dedicated simulator recorded"
xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME" || die "recorded simulator is not $SIM_NAME; refusing"
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "E2E backend is not answering"

N="$(( $(cat "$RUN_DIR/runs" 2>/dev/null || echo 0) + 1 ))"; echo "$N" > "$RUN_DIR/runs"
API="http://127.0.0.1:$API_PORT/api/v1"
umask 077
ENVFILE="$RUN_DIR/accounts-$N.env"
python3 - "$API" "$(run_id)" "$N" "$ENVFILE" <<'PY'
import json, secrets, sys, urllib.request

api, run, n, envfile = sys.argv[1:5]

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

lines = []
tokens = {}
for key, first in (("A", "Alpha"), ("B", "Bravo")):
    suffix = secrets.token_hex(3)
    email = f"e2e-{run}-{n}-{key.lower()}-{suffix}@example.com"
    username = f"e2e_{n}_{key.lower()}_{suffix}"
    password = f"Aa1-{secrets.token_hex(10)}"
    reply = call("POST", "/auth/register", {"email": email, "username": username, "password": password, "first_name": first})
    tokens[key] = reply["tokens"]["access_token"]
    lines += [f"E2E_EMAIL_{key}={email}", f"E2E_PASSWORD_{key}={password}"]

# Account A's private data: a finished workout and one still in progress.
done = call("POST", "/workouts", {"title": "Alpha finished session"}, tokens["A"])
call("POST", f"/workouts/{done['id']}/finish", None, tokens["A"])
call("POST", "/workouts", {"title": "Alpha open session"}, tokens["A"])
open(envfile, "w").write("\n".join(lines) + "\n")
PY
set -a; source "$ENVFILE"; set +a
echo "e2e: run $N with two new temporary accounts (credentials in $ENVFILE, mode 600)"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/session-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/session-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" \
  -e E2E_EMAIL_A="$E2E_EMAIL_A" -e E2E_PASSWORD_A="$E2E_PASSWORD_A" \
  -e E2E_EMAIL_B="$E2E_EMAIL_B" -e E2E_PASSWORD_B="$E2E_PASSWORD_B" \
  --test-output-dir "$OUT" 2>&1 | sed -e "s/$E2E_PASSWORD_A/<password-a>/g" -e "s/$E2E_PASSWORD_B/<password-b>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
exit "$STATUS"
