#!/usr/bin/env bash
# Brings up the isolated E2E stack: database, Redis and backend, the dedicated
# simulator with Expo Go, and a Metro server that points at that backend.
# (Accounts are created per run by run.sh.) It refuses to start while another
# run exists: run down.sh first.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need docker "Docker Desktop"
need node "Node"
need xcrun "Xcode command line tools"
need curl curl
need maestro "see mobile/README.md, Native UI smoke test"
docker info >/dev/null 2>&1 || die "Docker is not running"

[ ! -e "$RUN_DIR/run-id" ] || die "a run already exists in $RUN_DIR; run scripts/down.sh first"
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] \
  || die "containers of project $PROJECT exist but no run is recorded; inspect them and remove them yourself"
for port in "$API_PORT" "$METRO_PORT"; do
  ! lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1 || die "port $port is in use; set E2E_API_PORT / E2E_METRO_PORT"
done

mkdir -p "$RUN_DIR"; chmod 700 "$E2E_HOME" "$RUN_DIR"
RUN_ID="$(date +%Y%m%d%H%M%S)-$(openssl rand -hex 3)"
umask 077
{
  echo "E2E_RUN_ID=$RUN_ID"
  echo "E2E_DB_PASSWORD=$(openssl rand -hex 16)"
  echo "E2E_JWT_SECRET=$(openssl rand -hex 32)"
  echo "E2E_API_PORT=$API_PORT"
} > "$RUN_DIR/compose.env"
echo "$RUN_ID" > "$RUN_DIR/run-id"
mkdir -p "$RUN_DIR/artifacts"

echo "e2e: starting stack $RUN_ID (backend on 127.0.0.1:$API_PORT)"
if ! compose up -d --build >"$RUN_DIR/compose-up.log" 2>&1; then
  # Building needs the registry for the base image. Offline, an already built backend
  # image is still usable (it is only stale if backend/ changed since it was built).
  if grep -q "failed to resolve source metadata" "$RUN_DIR/compose-up.log" \
     && docker image inspect "$PROJECT-backend" >/dev/null 2>&1; then
    echo "e2e: WARNING: cannot reach the registry; using the existing $PROJECT-backend image built $(docker image inspect -f '{{.Created}}' "$PROJECT-backend")"
    compose up -d >"$RUN_DIR/compose-up.log" 2>&1 \
      || { tail -20 "$RUN_DIR/compose-up.log"; die "compose up failed (log: $RUN_DIR/compose-up.log)"; }
  else
    tail -20 "$RUN_DIR/compose-up.log"; die "compose up failed (log: $RUN_DIR/compose-up.log)"
  fi
fi

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "backend did not become healthy (docker compose -p $PROJECT logs backend)"

# Mark the database so cleanup can prove it is the one this run created.
compose exec -T db psql -U e2e -d postgres -v ON_ERROR_STOP=1 \
  -c "comment on database $DB_NAME is 'bodytrack-e2e-run:$RUN_ID'" >/dev/null

# The backend must really be on the E2E database (not whatever a stray .env says).
compose exec -T backend python -c "
from sqlalchemy.engine import make_url
from app.core.config import settings
u = make_url(settings.DATABASE_URL)
assert (u.host, u.database) == ('db', 'bodytrack_e2e'), (u.host, u.database)
print('backend database verified:', u.host, u.database)"

"$E2E_DIR/scripts/sim.sh"

echo "e2e: starting Metro on $METRO_PORT"
(
  cd "$MOBILE_DIR"
  # ipv4first: with `--host localhost` Metro would otherwise bind only ::1, while
  # the manifest it serves points the app at 127.0.0.1.
  EXPO_PUBLIC_API_URL="http://127.0.0.1:$API_PORT" EXPO_NO_TELEMETRY=1 CI=1 NODE_OPTIONS=--dns-result-order=ipv4first \
    nohup npx expo start --port "$METRO_PORT" --host localhost --clear >"$RUN_DIR/metro.log" 2>&1 &
  echo $! > "$RUN_DIR/metro.pid"
)
for _ in $(seq 1 90); do
  [ "$(curl -fsS "http://localhost:$METRO_PORT/status" 2>/dev/null || true)" = "packager-status:running" ] && break
  sleep 2
done
[ "$(curl -fsS "http://localhost:$METRO_PORT/status" 2>/dev/null || true)" = "packager-status:running" ] || die "Metro did not start (log: $RUN_DIR/metro.log)"
echo "e2e: ready. Run: e2e/scripts/run.sh"
