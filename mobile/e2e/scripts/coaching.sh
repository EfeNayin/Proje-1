#!/usr/bin/env bash
# Runs the coach–athlete permission flow once against the running E2E stack, from a
# controlled initial state: a brand-new coach and a brand-new athlete (the athlete owns
# one finished workout with known sets and one unfinished workout), a freshly installed
# Expo Go with an emptied keychain, and then no storage or keychain reset while the one
# simulator signs the two accounts in and out in turn. Same isolation as run.sh.
#
# Fixtures are the only thing created through the API. The connection itself (invite,
# accept, sharing on/off, end) is done on screen by the flow. The invite code travels
# from the coach's screen to the athlete's input inside Maestro (copy, paste); it is
# never written to a file by this script, and the artifacts are scrubbed afterwards.
#
#   e2e/scripts/up.sh && e2e/scripts/coaching.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/coaching-permissions.yaml}"
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

# The athlete's deterministic history: one finished session with known values and one
# that is still open (a coach must never see an open session, even with sharing on).
athlete = tokens["ATHLETE"]
found = call("GET", "/exercises?" + urllib.parse.urlencode({"q": "Barbell Bench Press"}), None, athlete)
items = found["items"] if isinstance(found, dict) else found
bench = next(item for item in items if item["name"] == "Barbell Bench Press")["id"]
sets = [
    {"exercise_id": bench, "weight_kg": "40", "reps": 10, "is_warmup": True},
    {"exercise_id": bench, "weight_kg": "80", "reps": 8, "rir": 2},
    {"exercise_id": bench, "weight_kg": "82.5", "reps": 6, "rir": 1},
]
done = call("POST", "/workouts", {"title": "Avery Push Fixture", "sets": sets}, athlete)
call("POST", f"/workouts/{done['id']}/finish", None, athlete)
call("POST", "/workouts", {"title": "Avery Open Session"}, athlete)
open(envfile, "w").write("\n".join(lines) + "\n")
PY
set -a; source "$ENVFILE"; set +a
# What the coach types: a first text, then a sentence appended to it by editing.
export FEEDBACK_FIRST="Bar speed held up on the top set. Keep your elbows tucked."
export FEEDBACK_ADDED="Pause the bar on your chest."
echo "e2e: run $N with a new coach and a new athlete (credentials in $ENVFILE, mode 600)"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/coaching-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/coaching-$N.log"
# What is replaced in every log line: both passwords and anything shaped like an invite code,
# in the plain form (12 characters of the code alphabet in groups of four) and in the form the
# screen reader label uses ("Invite code A B C D - E F G H - ...", one character at a time).
CODE_RE='[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}'
SPELLED_RE='Invite code [A-HJ-NP-Z2-9 -]{10,}'
scrub() {
  sed -E -e "s/$E2E_PASSWORD_COACH/<password-coach>/g" -e "s/$E2E_PASSWORD_ATHLETE/<password-athlete>/g" \
    -e "s/$SPELLED_RE/Invite code <invite-code>/g" -e "s/$CODE_RE/<invite-code>/g"
}
MARK="$RUN_DIR/.maestro-start-$N"; : > "$MARK"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" \
  -e E2E_EMAIL_COACH="$E2E_EMAIL_COACH" -e E2E_PASSWORD_COACH="$E2E_PASSWORD_COACH" \
  -e E2E_EMAIL_ATHLETE="$E2E_EMAIL_ATHLETE" -e E2E_PASSWORD_ATHLETE="$E2E_PASSWORD_ATHLETE" \
  -e FEEDBACK_FIRST="$FEEDBACK_FIRST" -e FEEDBACK_ADDED="$FEEDBACK_ADDED" \
  --test-output-dir "$OUT" 2>&1 | scrub | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e

# Maestro's own output files can hold the view hierarchy; scrub the text ones in place and
# report whether anything code-shaped or credential-shaped is left.
# Maestro also keeps its own maestro.log under ~/.maestro/tests; only the folders this run created are touched.
{ find "$OUT" -type f; find "$HOME/.maestro/tests" -mindepth 1 -maxdepth 1 -newer "$MARK" -exec find {} -type f \; ; } \
  | grep -E '\.(json|log|txt|xml|html)$' | tr '\n' '\0' \
  | while IFS= read -r -d '' file; do
      scrub < "$file" > "$file.scrubbed" && mv "$file.scrubbed" "$file"
    done
rm -f "$MARK"
LEFT="$(grep -rlE -e "$CODE_RE" -e "$SPELLED_RE" -e "$E2E_PASSWORD_COACH" -e "$E2E_PASSWORD_ATHLETE" "$OUT" "$LOG" 2>/dev/null | wc -l | tr -d ' ' || true)"
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository; text files with a code or password left after scrubbing: $LEFT"
[ "$STATUS" -eq 0 ] || exit "$STATUS"

# ── what the screens cannot show: independent read-only checks of the final state ──
# These are NOT native UI evidence. They read the database and call the public API with the
# two accounts' own tokens, after the flow, to prove what the screens only imply (that the
# stored text is exactly what was typed, that nobody but the athlete can read it once the
# connection is over, that the open session never got a feedback row). The flow ends with the
# connection ended, so these are the end-state claims; the on-screen steps before it carry the
# rest. Nothing here writes.
DBC="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db")"
[ -n "$DBC" ] || die "E2E database container not found"
sql() { docker exec -i "$DBC" psql -U e2e -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 -c "$1"; }
export DB_LINKS="$(sql "select count(*) || '|' || count(ended_at) || '|' || coalesce(bool_and(shares_workouts)::text, '') from coach_athlete_links l join users c on c.id = l.coach_id where c.email = '$E2E_EMAIL_COACH'")"
export DB_LINK_ID="$(sql "select l.id from coach_athlete_links l join users c on c.id = l.coach_id where c.email = '$E2E_EMAIL_COACH'")"
export DB_FEEDBACK="$(sql "select count(*) || '|' || coalesce(max(f.version)::text, '') || '|' || coalesce(max(f.body), '') from workout_feedback f join coach_athlete_links l on l.id = f.link_id join users c on c.id = l.coach_id where c.email = '$E2E_EMAIL_COACH'")"
export DB_OPEN_FEEDBACK="$(sql "select count(*) from workout_feedback f join workouts w on w.id = f.workout_id where w.title = 'Avery Open Session' and w.user_id = (select id from users where email = '$E2E_EMAIL_ATHLETE')")"
export DB_OPEN_UNFINISHED="$(sql "select count(*) from workouts where title = 'Avery Open Session' and finished_at is null and user_id = (select id from users where email = '$E2E_EMAIL_ATHLETE')")"
python3 - "$API" <<'PY'
import json, os, sys, urllib.error, urllib.request, uuid

api = sys.argv[1]
env = os.environ

def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None), raw.decode()
    except urllib.error.HTTPError as error:
        return error.code, None, error.read().decode()

failed = []
def check(label, ok):
    print(f"e2e-api: {'ok  ' if ok else 'FAIL'} {label}")
    if not ok: failed.append(label)

expected = env["FEEDBACK_FIRST"] + " " + env["FEEDBACK_ADDED"]
links, ended, sharing = (env["DB_LINKS"].split("|") + ["", "", ""])[:3]
count, version, body = (env["DB_FEEDBACK"].split("|", 2) + ["", ""])[:3]
check("db: the coach has exactly one connection, and it is ended", links == "1" and ended == "1")
check("db: sharing was left off by the athlete before the end", sharing == "false")
check("db: exactly one feedback row exists, edited once (version 2)", count == "1" and version == "2")
check("db: the stored text is exactly what was typed (first text + the appended sentence)", body == expected)
check("db: the unfinished session is still unfinished and carries no feedback",
      env["DB_OPEN_UNFINISHED"] == "1" and env["DB_OPEN_FEEDBACK"] == "0")

def login(who):
    status, reply, _ = call("POST", "/auth/login", {"email": env[f"E2E_EMAIL_{who}"], "password": env[f"E2E_PASSWORD_{who}"]})
    return reply["tokens"]["access_token"] if status == 200 else None

coach, athlete = login("COACH"), login("ATHLETE")
check("api: both accounts can still sign in", bool(coach and athlete))
status, workouts, _ = call("GET", "/workouts?limit=50", None, athlete)
items = (workouts or {}).get("items", workouts) if status == 200 else []
fixture = next((w["id"] for w in items if w.get("title") == "Avery Push Fixture"), None)
check("api: the athlete's own workout list still holds the finished fixture", fixture is not None)

status, received, text = call("GET", f"/coaching/workouts/{fixture}/feedback", None, athlete)
mine = (received or {}).get("items", [])
check("api: the athlete still reads the coach's feedback after the connection ended",
      status == 200 and len(mine) == 1 and mine[0]["body"] == expected)
check("api: the author is shown by public name only (no email, no password hash, no ids but the person's)",
      bool(mine) and env["E2E_EMAIL_COACH"] not in text and "password" not in text.lower() and "hash" not in text.lower())

status, connections, _ = call("GET", "/coaching/athletes", None, coach)
check("api: the coach's athlete list is empty after the end", status == 200 and connections["items"] == [])
link = env["DB_LINK_ID"]
statuses = [
    call("GET", f"/coaching/athletes/{link}/workouts", None, coach)[0],
    call("GET", f"/coaching/athletes/{link}/workouts/{fixture}", None, coach)[0],
    call("GET", f"/coaching/athletes/{link}/workouts/{fixture}/feedback", None, coach)[0],
]
check("api: the coach is refused the workout list, the workout and the feedback (404 each)", statuses == [404, 404, 404])
feedback_path = f"/coaching/athletes/{link}/workouts/{fixture}/feedback"
mutations = [
    call("PATCH", feedback_path, {"body": "late edit", "expected_version": 2}, coach)[0],
    call("DELETE", feedback_path + "?expected_version=2", None, coach)[0],
    call("PUT", feedback_path + "/requests/" + str(uuid.uuid4()), {"body": "late new"}, coach)[0],
]
check("api: the coach can no longer edit, delete or add feedback through the ended link (404 each)", mutations == [404, 404, 404])
check("api: the athlete is not the author, so the athlete cannot use the coach endpoints on that link",
      call("GET", f"/coaching/athletes/{link}/workouts/{fixture}/feedback", None, athlete)[0] in (403, 404))
status, again, _ = call("GET", f"/coaching/workouts/{fixture}/feedback", None, athlete)
check("api: nothing above changed the feedback", status == 200 and again["items"][0]["body"] == expected)

print(f"e2e-api: {len(failed)} failed")
sys.exit(1 if failed else 0)
PY
