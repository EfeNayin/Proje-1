#!/usr/bin/env bash
# Runs the athlete-specific program flow once against the running E2E stack, from a
# controlled initial state: a brand-new coach and a brand-new athlete who are already
# connected, a freshly installed Expo Go with an emptied keychain, and then no storage or
# keychain reset while the one simulator signs the two accounts in and out in turn.
# Same isolation as run.sh.
#
# Fixtures are the only thing created through the API: the connection, the coach's own
# program with one day and one exercise, and the athlete's own active program. Preparing,
# publishing, receiving and accepting are done on screen by the flow. The invite code is
# used inside this script's memory only; it is never printed or written anywhere.
#
#   e2e/scripts/up.sh && e2e/scripts/revisions.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/program-revisions.yaml}"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
UDID="$(sim_udid)"; [ -n "$UDID" ] || die "no dedicated simulator recorded"
xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME" || die "recorded simulator is not $SIM_NAME; refusing"
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "E2E backend is not answering"

N="$(( $(cat "$RUN_DIR/runs" 2>/dev/null || echo 0) + 1 ))"; echo "$N" > "$RUN_DIR/runs"
API="http://127.0.0.1:$API_PORT/api/v1"
umask 077
ENVFILE="$RUN_DIR/accounts-$N.env"
python3 - "$API" "$(run_id)" "$N" "$ENVFILE" <<'PY'
import json, secrets, sys, urllib.parse, urllib.request

api, run, n, envfile = sys.argv[1:5]

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

lines, tokens = [], {}
for key, first in (("COACH", "Colt"), ("ATHLETE", "Avery")):
    suffix = secrets.token_hex(3)
    email = f"e2e-{run}-{n}-{key.lower()}-{suffix}@example.com"
    username = f"e2e_{n}_{key.lower()}_{suffix}"
    password = f"Aa1-{secrets.token_hex(10)}"
    reply = call("POST", "/auth/register", {"email": email, "username": username, "password": password, "first_name": first})
    tokens[key] = reply["tokens"]["access_token"]
    lines += [f"E2E_EMAIL_{key}={email}", f"E2E_PASSWORD_{key}={password}"]

coach, athlete = tokens["COACH"], tokens["ATHLETE"]
call("POST", "/coaching/enable", None, coach)
invite = call("POST", "/coaching/invites", None, coach)
call("POST", "/coaching/invites/accept", {"code": invite["code"]}, athlete)

found = call("GET", "/exercises?" + urllib.parse.urlencode({"q": "Barbell Bench Press"}), None, coach)
items = found["items"] if isinstance(found, dict) else found
bench = next(item for item in items if item["name"] == "Barbell Bench Press")["id"]
base = call("POST", "/programs", {"name": "Coach Base"}, coach)
call("POST", f"/programs/{base['id']}/templates/with-exercises", {
    "name": "Push Day", "day_order": 0,
    "exercises": [{"exercise_id": bench, "target_sets": 3, "target_reps_min": 6, "target_reps_max": 8, "target_rir": 1}],
}, coach)
call("POST", "/programs", {"name": "Athlete Own"}, athlete)
open(envfile, "w").write("\n".join(lines) + "\n")
PY
set -a; source "$ENVFILE"; set +a
echo "e2e: run $N with a new coach and a new athlete (credentials in $ENVFILE, mode 600)"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/revisions-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/revisions-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" \
  -e E2E_EMAIL_COACH="$E2E_EMAIL_COACH" -e E2E_PASSWORD_COACH="$E2E_PASSWORD_COACH" \
  -e E2E_EMAIL_ATHLETE="$E2E_EMAIL_ATHLETE" -e E2E_PASSWORD_ATHLETE="$E2E_PASSWORD_ATHLETE" \
  --test-output-dir "$OUT" 2>&1 \
  | sed -e "s/$E2E_PASSWORD_COACH/<password-coach>/g" -e "s/$E2E_PASSWORD_ATHLETE/<password-athlete>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
exit "$STATUS"
