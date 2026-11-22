#!/usr/bin/env bash
# Account deletion, end to end on the isolated E2E stack:
#
#   fixtures (API)   COACH (the account that will be deleted) with a connected ATHLETE, a
#                    program the athlete accepted, workouts for both, and an unrelated
#                    BYSTANDER. All three are brand-new accounts created for this run.
#   native (Maestro) flows/account-deletion.yaml: cancel, wrong password, right password,
#                    final confirmation, relaunch stays signed out.
#   evidence (API + database)  what the screens cannot show: the old credentials and
#                    tokens are dead, the deleted account's rows are gone from every
#                    table, the athlete's copy, workouts and the bystander survive, and
#                    the shared exercise catalogue is untouched.
#
# Same isolation as run.sh/diagnosis.sh: the dedicated simulator and the bodytrack-e2e
# stack only, verified before anything is touched; accounts live in a mode-600 file
# outside the repository; passwords are masked in the log.
#
#   e2e/scripts/up.sh && e2e/scripts/deletion.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/account-deletion.yaml}"
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
ENVFILE="$RUN_DIR/deletion-$N.env"
STATE="$RUN_DIR/deletion-$N.json"
python3 - "$API" "$(run_id)" "$N" "$ENVFILE" "$STATE" <<'PY'
import json, secrets, sys, urllib.parse, urllib.request, uuid

api, run, n, envfile, statefile = sys.argv[1:6]

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

lines, tokens, ids = [], {}, {}
for key, first in (("COACH", "Dele"), ("ATHLETE", "Atlas"), ("BYSTANDER", "Bea")):
    suffix = secrets.token_hex(3)
    email = f"e2e-{run}-{n}-{key.lower()}-{suffix}@example.com"
    username = f"e2e_{n}_{key.lower()}_{suffix}"
    password = f"Aa1-{secrets.token_hex(10)}"
    reply = call("POST", "/auth/register", {"email": email, "username": username, "password": password,
                                            "first_name": first, "timezone": "Europe/Istanbul"})
    tokens[key] = reply["tokens"]["access_token"]
    ids[key] = reply["user"]["id"]
    lines += [f"E2E_EMAIL_{key}={email}", f"E2E_PASSWORD_{key}={password}", f"E2E_USERNAME_{key}={username}"]

found = call("GET", "/exercises?" + urllib.parse.urlencode({"q": "Barbell Bench Press"}), None, tokens["COACH"])
items = found["items"] if isinstance(found, dict) else found
bench = next(item for item in items if item["name"] == "Barbell Bench Press")["id"]

def workout(key, title):
    return call("POST", "/workouts", {"title": title, "sets": [{"exercise_id": bench, "weight_kg": "60", "reps": 8} for _ in range(3)]},
                tokens[key])["id"]

# COACH coaches ATHLETE and sends them a program, which ATHLETE accepts.
call("POST", "/coaching/enable", None, tokens["COACH"])
code = call("POST", "/coaching/invites", None, tokens["COACH"])["code"]
link = call("POST", "/coaching/invites/accept", {"code": code}, tokens["ATHLETE"])["id"]
program = call("POST", "/programs", {"name": "Deletion Fixture Program"}, tokens["COACH"])["id"]
call("POST", f"/programs/{program}/templates/with-exercises", {
    "name": "Push", "day_order": 0,
    "exercises": [{"exercise_id": bench, "target_sets": 4, "target_reps_min": 6, "target_reps_max": 8}]}, tokens["COACH"])
preview = call("GET", f"/coaching/athletes/{link}/program-preview/{program}", None, tokens["COACH"])
offer = call("PUT", f"/coaching/athletes/{link}/program-offers/{uuid.uuid4()}",
             {"program_id": program, "fingerprint": preview["fingerprint"]}, tokens["COACH"])["id"]
copy = call("POST", f"/coaching/program-offers/{offer}/accept", None, tokens["ATHLETE"])["program_id"]
state = {
    "ids": ids, "link": link, "copy": copy, "bench": bench,
    "athlete_workout": workout("ATHLETE", "Athlete session"),
    "bystander_workout": workout("BYSTANDER", "Bystander session"),
    "coach_workout": workout("COACH", "Coach session"),
    "old_access": tokens["COACH"],
}
lines.append("E2E_WRONG_PASSWORD=Wrong-" + secrets.token_hex(6))
open(envfile, "w").write("\n".join(lines) + "\n")
open(statefile, "w").write(json.dumps(state))
PY
set -a; source "$ENVFILE"; set +a
echo "e2e: run $N, accounts COACH (to be deleted), ATHLETE (accepted the coach's program), BYSTANDER (credentials in $ENVFILE, mode 600)"

# ── what the catalogue and the other tables hold before ──
count() { docker exec -i "$DBC" psql -U e2e -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 -c "$1"; }
CATALOGUE_BEFORE="$(count "select (select count(*) from exercises)||'/'||(select count(*) from muscle_groups)||'/'||(select count(*) from exercise_muscle_groups)")"
COACH_ID="$(python3 -c "import json,sys;print(json.load(open('$STATE'))['ids']['COACH'])")"
[ "$(count "select count(*) from users where id = '$COACH_ID'")" = "1" ] || die "the fixture account is not in the E2E database"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/deletion-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/deletion-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" \
  -e E2E_EMAIL="$E2E_EMAIL_COACH" -e E2E_PASSWORD="$E2E_PASSWORD_COACH" \
  -e E2E_WRONG_PASSWORD="$E2E_WRONG_PASSWORD" \
  --test-output-dir "$OUT" 2>&1 \
  | sed -e "s/$E2E_PASSWORD_COACH/<password-coach>/g" -e "s/$E2E_WRONG_PASSWORD/<password-wrong>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
[ "$STATUS" -eq 0 ] || exit "$STATUS"

# ── what the screens cannot show: the server and the database afterwards ──
CATALOGUE_AFTER="$(count "select (select count(*) from exercises)||'/'||(select count(*) from muscle_groups)||'/'||(select count(*) from exercise_muscle_groups)")"
# Every table that can name a user, asked about the deleted account's id (and nothing else).
ROWS_LEFT="$(count "
select coalesce(sum(n),0) from (
  select count(*) n from users where id = '$COACH_ID'
  union all select count(*) from refresh_tokens where user_id = '$COACH_ID'
  union all select count(*) from workouts where user_id = '$COACH_ID'
  union all select count(*) from programs where user_id = '$COACH_ID'
  union all select count(*) from readiness_logs where user_id = '$COACH_ID'
  union all select count(*) from body_measurements where user_id = '$COACH_ID'
  union all select count(*) from template_save_requests where user_id = '$COACH_ID'
  union all select count(*) from coach_athlete_links where coach_id = '$COACH_ID' or athlete_id = '$COACH_ID' or ended_by_id = '$COACH_ID'
  union all select count(*) from coach_invites where coach_id = '$COACH_ID' or accepted_by_id = '$COACH_ID'
  union all select count(*) from program_lineages where coach_id = '$COACH_ID'
  union all select count(*) from program_offers where coach_id = '$COACH_ID'
  union all select count(*) from exercises where created_by = '$COACH_ID'
) t")"
echo "e2e-db: rows still naming the deleted account: $ROWS_LEFT"
echo "e2e-db: catalogue (exercises/muscle groups/links) before $CATALOGUE_BEFORE, after $CATALOGUE_AFTER"
export ROWS_LEFT CATALOGUE_BEFORE CATALOGUE_AFTER
python3 - "$API" "$STATE" <<'PY'
import json, os, sys, urllib.error, urllib.request
api, statefile = sys.argv[1:3]
state = json.load(open(statefile))

def call(method, path, body=None, token=None, expect=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        return error.code, None

def login(key):
    status, reply = call("POST", "/auth/login", {"email": os.environ[f"E2E_EMAIL_{key}"], "password": os.environ[f"E2E_PASSWORD_{key}"]})
    return status, (reply["tokens"]["access_token"] if reply else None)

failed = []
def check(label, ok):
    print(f"e2e-api: {'ok  ' if ok else 'FAIL'} {label}")
    if not ok: failed.append(label)

check("COACH: the old credentials no longer sign in", login("COACH")[0] == 401)
check("COACH: the access token from before the deletion is refused", call("GET", "/users/me", None, state["old_access"])[0] == 401)
check("COACH: no row of any table still names the account", os.environ["ROWS_LEFT"] == "0")
check("the exercise catalogue is untouched", os.environ["CATALOGUE_BEFORE"] == os.environ["CATALOGUE_AFTER"])

status, token = login("ATHLETE")
check("ATHLETE: still signs in", status == 200)
_, programs = call("GET", "/programs", None, token)
check("ATHLETE: keeps the accepted copy of the coach's program", any(p["id"] == state["copy"] for p in programs))
_, copy = call("GET", f"/programs/{state['copy']}", None, token)
check("ATHLETE: the copy is intact (one day, one exercise)", len(copy["templates"]) == 1 and len(copy["templates"][0]["exercises"]) == 1)
_, workouts = call("GET", "/workouts?limit=100", None, token)
check("ATHLETE: keeps their workout with its 3 sets", workouts["total"] == 1 and workouts["items"][0]["id"] == state["athlete_workout"])
_, coaches = call("GET", "/coaching/coaches", None, token)
check("ATHLETE: no connection to the deleted coach is left", coaches["items"] == [])

status, token = login("BYSTANDER")
check("BYSTANDER: still signs in and keeps their workout", status == 200 and call("GET", "/workouts?limit=100", None, token)[1]["total"] == 1)
sys.exit(1 if failed else 0)
PY
