#!/usr/bin/env bash
# Password recovery, end to end on the isolated E2E stack:
#
#   fixtures (API)   a disposable account ("forgetful") that is signed in on two devices, an
#                    unrelated BYSTANDER, and an address that has no account. All new for
#                    this run; the inbox is emptied first.
#   native (Maestro) flows/password-recovery.yaml: the app asks for a code, the code is read
#                    from the isolated test inbox, typed in, the password reset, the old
#                    password refused and the new one signed in.
#   evidence (API + inbox + database)  what the screens cannot show: the old access and
#                    refresh tokens of both devices are dead, a replay of the code is refused,
#                    the mailbox holds exactly the recovery code and the password-changed
#                    notice (and neither contains the new password), an address without an
#                    account got the identical answer and no mail, the bystander is untouched.
#
# Same isolation as deletion.sh: the dedicated simulator and the bodytrack-e2e stack only,
# verified before anything is touched; accounts live in a mode-600 file outside the
# repository; passwords are masked in the log. The test inbox is the E2E stack's own SMTP
# sink: nothing is ever sent to a real address.
#
#   e2e/scripts/up.sh && e2e/scripts/recovery.sh; e2e/scripts/down.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FLOW="${1:-$E2E_DIR/flows/password-recovery.yaml}"
[ -f "$RUN_DIR/compose.env" ] || die "no run: start it with scripts/up.sh"
UDID="$(sim_udid)"; [ -n "$UDID" ] || die "no dedicated simulator recorded"
xcrun simctl list devices | grep "$UDID" | grep -q "$SIM_NAME" || die "recorded simulator is not $SIM_NAME; refusing"
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "E2E backend is not answering"
MAIL_API="http://127.0.0.1:$MAIL_PORT"
curl -fsS "$MAIL_API/health" >/dev/null || die "E2E test inbox is not answering"
verify_identity
DBC="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db")"
[ -n "$DBC" ] || die "E2E database container not found"

N="$(( $(cat "$RUN_DIR/runs" 2>/dev/null || echo 0) + 1 ))"; echo "$N" > "$RUN_DIR/runs"
API="http://127.0.0.1:$API_PORT/api/v1"
umask 077
ENVFILE="$RUN_DIR/recovery-$N.env"
STATE="$RUN_DIR/recovery-$N.json"
curl -fsS -X DELETE "$MAIL_API/messages" >/dev/null
python3 - "$API" "$(run_id)" "$N" "$ENVFILE" "$STATE" <<'PY'
import json, secrets, sys, urllib.request

api, run, n, envfile, statefile = sys.argv[1:6]

def call(method, path, body=None):
    request = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

lines, state = [], {}
for key in ("FORGETFUL", "BYSTANDER"):
    suffix = secrets.token_hex(3)
    email = f"e2e-{run}-{n}-{key.lower()}-{suffix}@example.com"
    username = f"e2e_{n}_{key.lower()}_{suffix}"
    password = f"Aa1-{secrets.token_hex(10)}"
    reply = call("POST", "/auth/register", {"email": email, "username": username, "password": password,
                                            "first_name": key.capitalize(), "timezone": "Europe/Istanbul"})
    lines += [f"E2E_EMAIL_{key}={email}", f"E2E_PASSWORD_{key}={password}"]
    state[key] = {"registered": reply["tokens"]}
    if key == "FORGETFUL":
        # A second device, signed in with the same password.
        state[key]["second_device"] = call("POST", "/auth/login", {"email": email, "password": password})["tokens"]
lines.append("E2E_NEW_PASSWORD=New-" + secrets.token_hex(10))
lines.append(f"E2E_NOBODY_EMAIL=e2e-{run}-{n}-nobody-{secrets.token_hex(3)}@example.com")
open(envfile, "w").write("\n".join(lines) + "\n")
open(statefile, "w").write(json.dumps(state))
PY
set -a; source "$ENVFILE"; set +a
echo "e2e: run $N, accounts FORGETFUL (two devices), BYSTANDER (credentials in $ENVFILE, mode 600)"

# ── controlled starting state: only the dedicated simulator is touched ──
xcrun simctl terminate "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl keychain "$UDID" reset
APP="$(ls -d "$E2E_HOME"/expo-go-sdk*/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || APP="$(ls -d "$HOME"/.expo/ios-simulator-app-cache/*.app | head -1)"
xcrun simctl install "$UDID" "$APP"

OUT="$RUN_DIR/artifacts/recovery-$N"; mkdir -p "$OUT"
LOG="$RUN_DIR/artifacts/recovery-$N.log"
set +e
maestro --udid "$UDID" test "$FLOW" \
  -e METRO_URL="exp://localhost:$METRO_PORT" -e MAIL_API="$MAIL_API" \
  -e E2E_EMAIL="$E2E_EMAIL_FORGETFUL" -e E2E_OLD_PASSWORD="$E2E_PASSWORD_FORGETFUL" \
  -e E2E_NEW_PASSWORD="$E2E_NEW_PASSWORD" \
  --test-output-dir "$OUT" 2>&1 \
  | sed -e "s/$E2E_PASSWORD_FORGETFUL/<password-old>/g" -e "s/$E2E_NEW_PASSWORD/<password-new>/g" | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e
echo "e2e: artifacts (screenshots, logs) in $OUT — outside the repository"
[ "$STATUS" -eq 0 ] || exit "$STATUS"

# ── what the screens cannot show ──
count() { docker exec -i "$DBC" psql -U e2e -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 -c "$1"; }
export CREDENTIAL_VERSION="$(count "select credential_version from users where email = '$E2E_EMAIL_FORGETFUL'")"
export CHALLENGES_LEFT="$(count "select count(*) from password_reset_challenges c join users u on u.id = c.user_id where u.email = '$E2E_EMAIL_FORGETFUL'")"
export BYSTANDER_VERSION="$(count "select credential_version from users where email = '$E2E_EMAIL_BYSTANDER'")"
echo "e2e-db: credential_version of the account $CREDENTIAL_VERSION (bystander $BYSTANDER_VERSION), recovery codes still stored for it: $CHALLENGES_LEFT"
python3 - "$API" "$MAIL_API" "$STATE" <<'PY'
import json, os, re, sys, urllib.error, urllib.request
api, mail_api, statefile = sys.argv[1:4]
state = json.load(open(statefile))
email, old, new = os.environ["E2E_EMAIL_FORGETFUL"], os.environ["E2E_PASSWORD_FORGETFUL"], os.environ["E2E_NEW_PASSWORD"]

def call(method, path, body=None, token=None, base=None):
    request = urllib.request.Request(
        (base or api) + path, method=method, data=json.dumps(body).encode() if body is not None else None,
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

inbox = call("GET", "/messages", base=mail_api)[1]
mine = [m for m in inbox if m["to"] == [email]]
codes = [m for m in mine if "reset code" in m["subject"]]
notices = [m for m in mine if "password was changed" in m["subject"]]
check("the inbox holds the recovery code mail for the account (the app asked for it)", len(codes) == 1)
check("the inbox holds exactly one password-changed notice", len(notices) == 1)
check("the notice names neither the new password, the old one, nor the code",
      bool(notices) and new not in notices[0]["body"] and old not in notices[0]["body"]
      and not re.search(r"\b\d{4} \d{4}\b", notices[0]["body"]))
check("no mail went to anyone else", len(mine) == len(inbox))
code = re.search(r"\b(\d{4}) (\d{4})\b", codes[0]["body"])
code = code.group(1) + code.group(2) if code else ""

status, _, _ = call("POST", "/auth/login", {"email": email, "password": old})
check("the old password no longer signs in", status == 401)
status, body, _ = call("POST", "/auth/login", {"email": email, "password": new})
check("the new password signs in", status == 200)

for device in ("registered", "second_device"):
    tokens = state["FORGETFUL"][device]
    check(f"{device}: the access token from before the reset is refused",
          call("GET", "/users/me", None, tokens["access_token"])[0] == 401)
    check(f"{device}: the refresh token from before the reset is refused",
          call("POST", "/auth/refresh", {"refresh_token": tokens["refresh_token"]})[0] == 401)

status, replay, text = call("POST", "/auth/password-recovery/confirm",
                            {"email": email, "code": code, "new_password": "Replay-" + new})
check("replaying the used code is refused", status == 400)
check("the replay changed nothing (the new password still works)",
      call("POST", "/auth/login", {"email": email, "password": new})[0] == 200
      and call("POST", "/auth/login", {"email": email, "password": "Replay-" + new})[0] == 401)
check("no response above carried the code or a password", code not in text and new not in text)

nobody = os.environ["E2E_NOBODY_EMAIL"]
# Like with like: the app has already asked for FORGETFUL's code (that address is inside its own
# cooldown), so a real address nobody has asked for yet, BYSTANDER's, stands for "an account that
# exists" against an address with no account. Fresh against fresh, then again inside the cooldown.
real = os.environ["E2E_EMAIL_BYSTANDER"]
known = call("POST", "/auth/password-recovery/request", {"email": real})
unknown = call("POST", "/auth/password-recovery/request", {"email": nobody})
check("an address without an account gets the same status and body as a real one",
      known[0] == unknown[0] == 202 and known[1] == unknown[1] and known[2] == unknown[2])
known = call("POST", "/auth/password-recovery/request", {"email": real})
unknown = call("POST", "/auth/password-recovery/request", {"email": nobody})
check("...and the same refusal when asked again inside the cooldown",
      known[0] == unknown[0] == 429 and known[2] == unknown[2])
after = call("GET", "/messages", base=mail_api)[1]
check("...and no mail was sent to it", all(nobody not in m["to"] for m in after))

status, tokens, _ = call("POST", "/auth/login", {"email": os.environ["E2E_EMAIL_BYSTANDER"], "password": os.environ["E2E_PASSWORD_BYSTANDER"]})
check("BYSTANDER: still signs in with their own password", status == 200)
check("BYSTANDER: the access token from before is still valid",
      call("GET", "/users/me", None, state["BYSTANDER"]["registered"]["access_token"])[0] == 200)
check("the account's credential version moved on once and no code is left",
      os.environ["CREDENTIAL_VERSION"] == "1" and os.environ["CHALLENGES_LEFT"] == "0")
check("the bystander's credential version did not move", os.environ["BYSTANDER_VERSION"] == "0")
sys.exit(1 if failed else 0)
PY
