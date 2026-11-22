#!/usr/bin/env bash
# Runs the "Why am I not growing?" journeys once against the running E2E stack, from a
# controlled initial state: three brand-new accounts, a freshly installed Expo Go with an
# emptied keychain, and then no storage or keychain reset while the one simulator signs
# the accounts in and out in turn. Same isolation as run.sh.
#
#   EMPTY    no records at all. Journey (a): assessment -> standalone daily check-in ->
#            save -> back on the refreshed assessment. This script then checks through the
#            API that the account has ZERO workouts and that today's record holds the entry.
#   HISTORY  four completed weeks of training, five nights of sleep and four weigh-ins
#            spanning 19 days, with a bulk goal. Journey (b): assessment -> period change
#            -> an action to an existing screen.
#   FRESH    no readiness record today. Journey (c): the pre-workout check-in still starts
#            the workout; this script then checks it created exactly one.
#
# Fixtures: accounts, the goal, the past workouts and their sets are created through the
# API. A readiness log or weigh-in dated in the past cannot be written through the API
# (it only writes today), so those rows are inserted into the E2E database after its
# identity was verified (bodytrack_e2e, labelled with this run id). Nothing else is
# touched, and no real week is waited for.
#
#   e2e/scripts/up.sh && e2e/scripts/diagnosis.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/diagnosis-checkin.yaml}"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
UDID="$(sim_udid)"; [ -n "$UDID" ] || die "no dedicated simulator recorded"
xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME" || die "recorded simulator is not $SIM_NAME; refusing"
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "E2E backend is not answering"
verify_identity
DBC="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db")"
[ -n "$DBC" ] || die "E2E database container not found"

N="$(( $(cat "$RUN_DIR/runs" 2>/dev/null || echo 0) + 1 ))"; echo "$N" > "$RUN_DIR/runs"
API="http://127.0.0.1:$API_PORT/api/v1"
umask 077
ENVFILE="$RUN_DIR/accounts-$N.env"
SQLFILE="$RUN_DIR/fixture-$N.sql"
python3 - "$API" "$(run_id)" "$N" "$ENVFILE" "$SQLFILE" <<'PY'
import json, secrets, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

api, run, n, envfile, sqlfile = sys.argv[1:6]
TZ = ZoneInfo("Europe/Istanbul")

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

lines, tokens, ids = [], {}, {}
for key, first in (("EMPTY", "Eli"), ("HISTORY", "Hana"), ("FRESH", "Fay")):
    suffix = secrets.token_hex(3)
    email = f"e2e-{run}-{n}-{key.lower()}-{suffix}@example.com"
    username = f"e2e_{n}_{key.lower()}_{suffix}"
    password = f"Aa1-{secrets.token_hex(10)}"
    reply = call("POST", "/auth/register", {"email": email, "username": username, "password": password,
                                            "first_name": first, "timezone": "Europe/Istanbul"})
    tokens[key] = reply["tokens"]["access_token"]
    ids[key] = call("GET", "/users/me", None, tokens[key])["id"]
    lines += [f"E2E_EMAIL_{key}={email}", f"E2E_PASSWORD_{key}={password}"]

# ── HISTORY: four completed weeks of training (two sessions each), via the API ──
token = tokens["HISTORY"]
call("PATCH", "/users/me", {"nutrition_goal": "bulk"}, token)
found = call("GET", "/exercises?" + urllib.parse.urlencode({"q": "Barbell Bench Press"}), None, token)
items = found["items"] if isinstance(found, dict) else found
bench = next(item for item in items if item["name"] == "Barbell Bench Press")["id"]
today = datetime.now(TZ).date()
monday = today - timedelta(days=today.weekday())
for week in range(1, 5):
    for day in (1, 3):
        when = datetime.combine(monday - timedelta(weeks=week) + timedelta(days=day), datetime.min.time(), TZ).replace(hour=12)
        call("POST", "/workouts", {
            "title": f"Fixture W-{week} D{day}", "performed_at": when.isoformat(),
            "sets": [{"exercise_id": bench, "weight_kg": "60", "reps": 8} for _ in range(3)],
        }, token)

# ── past-dated readiness logs and weigh-ins: SQL into the verified E2E database ──
uid = ids["HISTORY"]  # a UUID returned by the API
sql = ["begin;"]
for age in range(1, 6):
    sql.append(f"insert into readiness_logs (user_id, log_date, sleep_hours) values ('{uid}', '{(today - timedelta(days=age)).isoformat()}', 5.5);")
for age, kg in ((19, "80.0"), (12, "80.1"), (6, "80.0"), (1, "80.1")):
    sql.append(f"insert into body_measurements (user_id, measured_on, weight_kg) values ('{uid}', '{(today - timedelta(days=age)).isoformat()}', {kg});")
sql.append("commit;")
open(sqlfile, "w").write("\n".join(sql) + "\n")
open(envfile, "w").write("\n".join(lines) + "\n")
PY
docker exec -i "$DBC" psql -U e2e -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$SQLFILE" >/dev/null
set -a; source "$ENVFILE"; set +a
echo "e2e: run $N with three new accounts: EMPTY, HISTORY (4 weeks, 5 nights, 4 weigh-ins), FRESH (credentials in $ENVFILE, mode 600)"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/diagnosis-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/diagnosis-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" \
  -e E2E_EMAIL_EMPTY="$E2E_EMAIL_EMPTY" -e E2E_PASSWORD_EMPTY="$E2E_PASSWORD_EMPTY" \
  -e E2E_EMAIL_HISTORY="$E2E_EMAIL_HISTORY" -e E2E_PASSWORD_HISTORY="$E2E_PASSWORD_HISTORY" \
  -e E2E_EMAIL_FRESH="$E2E_EMAIL_FRESH" -e E2E_PASSWORD_FRESH="$E2E_PASSWORD_FRESH" \
  --test-output-dir "$OUT" 2>&1 \
  | sed -e "s/$E2E_PASSWORD_EMPTY/<password-empty>/g" -e "s/$E2E_PASSWORD_HISTORY/<password-history>/g" \
        -e "s/$E2E_PASSWORD_FRESH/<password-fresh>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
[ "$STATUS" -eq 0 ] || exit "$STATUS"

# ── what the screens cannot show: the server's state after the journeys (API evidence) ──
python3 - "$API" <<'PY'
import json, os, sys, urllib.request
api = sys.argv[1]

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def login(key):
    reply = call("POST", "/auth/login", {"email": os.environ[f"E2E_EMAIL_{key}"], "password": os.environ[f"E2E_PASSWORD_{key}"]})
    return reply["tokens"]["access_token"] if "tokens" in reply else reply["access_token"]

failed = []
def check(label, ok):
    print(f"e2e-api: {'ok  ' if ok else 'FAIL'} {label}")
    if not ok: failed.append(label)

empty = login("EMPTY")
workouts = call("GET", "/workouts?limit=100", None, empty)
check("EMPTY: standalone check-in created ZERO workouts", workouts["total"] == 0)
check("EMPTY: no workout is in progress", call("GET", "/workouts/active", None, empty) is None)
today = call("GET", "/readiness/today", None, empty)
check("EMPTY: today's record holds the saved sleep (7.5 h) and energy (4)",
      today["id"] is not None and float(today["sleep_hours"]) == 7.5 and today["energy"] == 4)
check("EMPTY: fields never entered stay empty", today["mood"] is None and today["sleep_quality"] is None and today["soreness"] is None)

fresh = login("FRESH")
workouts = call("GET", "/workouts?limit=100", None, fresh)
check("FRESH: the pre-workout check-in started exactly one workout", workouts["total"] == 1)
today = call("GET", "/readiness/today", None, fresh)
check("FRESH: the pre-workout check-in saved the entered sleep (6.5 h)",
      today["id"] is not None and float(today["sleep_hours"]) == 6.5)

history = login("HISTORY")
check("HISTORY: still only its 8 fixture workouts (nothing was started)", call("GET", "/workouts?limit=100", None, history)["total"] == 8)
sys.exit(1 if failed else 0)
PY
