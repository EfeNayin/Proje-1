#!/usr/bin/env bash
# Local rehearsal of a hosted staging: builds the PRODUCTION image and runs it against TLS
# PostgreSQL, TLS Redis and an HTTPS Resend stand-in. See docker-compose.yml.
#
#   deploy/local-staging/run.sh up      generate throw-away secrets/certs, start the stack
#   deploy/local-staging/run.sh verify  run the checks (verify.py) against it
#   deploy/local-staging/run.sh down    remove the stack, its volumes and the run directory
#
# Everything generated lives in ~/.cache/bodytrack-staging-local (mode 700), never in the
# repository. It refuses to start while another run exists, and `down` removes only containers
# and volumes that carry this run's label.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="bodytrack-staging-local"
HOME_DIR="${STAGING_LOCAL_HOME:-$HOME/.cache/bodytrack-staging-local}"
RUN_DIR="$HOME_DIR/current"
API_PORT="${STAGING_API_PORT:-8200}"
STUB_PORT="${STAGING_STUB_PORT:-8243}"

die() { echo "staging-local: $*" >&2; exit 1; }
compose() { docker compose -p "$PROJECT" -f "$HERE/docker-compose.yml" --env-file "$RUN_DIR/compose.env" "$@"; }

up() {
  docker info >/dev/null 2>&1 || die "Docker is not running"
  [ ! -e "$RUN_DIR/run-id" ] || die "a run already exists in $RUN_DIR; run 'down' first"
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] \
    || die "containers of project $PROJECT exist but no run is recorded; inspect them first"
  for port in "$API_PORT" "$STUB_PORT"; do
    ! lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1 || die "port $port is in use"
  done
  mkdir -p "$RUN_DIR"; chmod 700 "$HOME_DIR" "$RUN_DIR"
  umask 077
  local run_id; run_id="$(date +%Y%m%d%H%M%S)-$(openssl rand -hex 3)"
  {
    echo "STAGING_RUN_ID=$run_id"
    echo "STAGING_DB_PASSWORD=$(openssl rand -hex 16)"
    echo "STAGING_REDIS_PASSWORD=$(openssl rand -hex 16)"
    echo "STAGING_JWT_SECRET=$(openssl rand -hex 32)"
    echo "STAGING_RESEND_KEY=re_local_$(openssl rand -hex 16)"
    echo "STAGING_API_PORT=$API_PORT"
    echo "STAGING_STUB_PORT=$STUB_PORT"
  } > "$RUN_DIR/compose.env"
  echo "$run_id" > "$RUN_DIR/run-id"
  echo "staging-local: building and starting run $run_id (API on 127.0.0.1:$API_PORT)"
  compose up -d --build >"$RUN_DIR/compose-up.log" 2>&1 \
    || { tail -30 "$RUN_DIR/compose-up.log"; die "compose up failed (log: $RUN_DIR/compose-up.log)"; }
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && { echo "staging-local: up"; return; }
    sleep 2
  done
  compose logs backend 2>&1 | tail -30
  die "backend did not become healthy"
}

verify() {
  [ -e "$RUN_DIR/run-id" ] || die "no run; use 'up' first"
  python3 -I "$HERE/verify.py" \
    --api "http://127.0.0.1:$API_PORT" \
    --stub "https://127.0.0.1:$STUB_PORT" \
    --env-file "$RUN_DIR/compose.env" \
    --project "$PROJECT" \
    --compose-file "$HERE/docker-compose.yml"
}

down() {
  [ -e "$RUN_DIR/run-id" ] || die "no run recorded; nothing to remove"
  local run_id; run_id="$(cat "$RUN_DIR/run-id")"
  local ids; ids="$(docker ps -aq --filter "label=com.bodytrack.staging-local.run=$run_id")"
  [ -z "$ids" ] || docker rm -f $ids >/dev/null
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] \
    || die "containers of $PROJECT remain; inspect them"
  rm -rf "$RUN_DIR"
  echo "staging-local: removed run $run_id (containers, volumes, run directory)"
}

case "${1:-}" in
  up) up ;;
  verify) verify ;;
  down) down ;;
  *) die "usage: run.sh up|verify|down" ;;
esac
