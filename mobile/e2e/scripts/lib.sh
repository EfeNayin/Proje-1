#!/usr/bin/env bash
# Shared helpers for the E2E scripts. Source it; do not run it.
#
# State lives OUTSIDE the repository: E2E_HOME (default ~/.cache/bodytrack-e2e)
# holds the current run's secrets, ids, logs and screenshots.

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$(cd "$E2E_DIR/.." && pwd)"
E2E_HOME="${E2E_HOME:-$HOME/.cache/bodytrack-e2e}"
RUN_DIR="$E2E_HOME/current"
PROJECT="bodytrack-e2e"
DB_NAME="bodytrack_e2e"
SIM_NAME="BodyTrack-E2E"

API_PORT="${E2E_API_PORT:-8100}"
METRO_PORT="${E2E_METRO_PORT:-8091}"

# Maestro needs Java 17+. Use whatever the environment already provides, else a
# Homebrew keg-only OpenJDK; nothing in the shell profile is touched.
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  for jdk in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17 /opt/homebrew/opt/openjdk; do
    [ -x "$jdk/bin/java" ] && export JAVA_HOME="$jdk" && export PATH="$jdk/bin:$PATH" && break
  done
fi
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_NO_ANALYTICS_NOTICE=1

die() { echo "e2e: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1 ($2)"; }

compose() {
  docker compose -f "$E2E_DIR/docker-compose.e2e.yml" --env-file "$RUN_DIR/compose.env" -p "$PROJECT" "$@"
}

# Run id recorded for the current run (empty if none).
run_id() { [ -f "$RUN_DIR/run-id" ] && cat "$RUN_DIR/run-id" || true; }

# Positively identify the E2E stack before anything destructive is done to it:
#  1. a run directory with a run id exists,
#  2. every container of the fixed compose project carries that exact run label,
#  3. the database is bodytrack_e2e and its comment names the same run id.
# Anything else -> refuse. Only call this before `down -v`.
verify_identity() {
  local id; id="$(run_id)"
  [ -n "$id" ] || die "refusing: no recorded run id in $RUN_DIR"
  local ids; ids="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")"
  [ -n "$ids" ] || return 0   # nothing running: only the volumes remain, still ours by project name
  local c label
  for c in $ids; do
    label="$(docker inspect -f '{{ index .Config.Labels "com.bodytrack.e2e.run" }}' "$c" 2>/dev/null || true)"
    [ "$label" = "$id" ] || die "refusing: container $c of project $PROJECT does not carry run id $id"
  done
  local dbc; dbc="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db")"
  if [ -n "$dbc" ]; then
    local got
    got="$(docker exec "$dbc" psql -U e2e -d "$DB_NAME" -tA \
      -c "select current_database() || '|' || coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname = current_database()" 2>/dev/null || true)"
    [ "$got" = "$DB_NAME|bodytrack-e2e-run:$id" ] || die "refusing: database identity is '$got', expected '$DB_NAME|bodytrack-e2e-run:$id'"
  fi
}

# The dedicated simulator outlives a single run (booting a fresh one is slow), so
# its UDID is stored beside, not inside, the per-run directory.
sim_udid() { [ -f "$E2E_HOME/sim-udid" ] && cat "$E2E_HOME/sim-udid" || true; }
