#!/bin/sh
# Container entrypoint of the "production" image (see the Dockerfile and README.md,
# "Staging'e dağıtım"). Plain sh: the slim image has no bash.
#
#   RUN_MIGRATIONS  true (default) | false
#       true: `alembic upgrade head` runs first. Already-applied migrations are a no-op,
#       a failing one stops the container before it serves anything (the deploy fails and
#       the previous release keeps running). false: the schema is managed by hand.
#   PORT            the port to listen on (Render assigns it; 8000 when unset).
#
# Everything else comes from the environment through app/core/config.py.
set -eu

case "${RUN_MIGRATIONS:-true}" in
  true)
    echo "start: applying database migrations (alembic upgrade head)"
    alembic upgrade head
    echo "start: migrations are at head"
    ;;
  false)
    echo "start: RUN_MIGRATIONS=false, not touching the schema"
    ;;
  *)
    echo "start: RUN_MIGRATIONS must be 'true' or 'false'" >&2
    exit 2
    ;;
esac

# One worker process: the free instance has a fraction of a CPU and 512 MB. Concurrency
# comes from the event loop; bcrypt runs in a small bounded thread pool (PASSWORD_WORK_*).
# --timeout-keep-alive is longer than uvicorn's 5 s default so a proxy that reuses idle
# connections does not hit one the server has just closed (precaution; see README).
# --proxy-headers is uvicorn's default and only applies to peers in FORWARDED_ALLOW_IPS
# (127.0.0.1 unless set); it is never widened here.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1 \
  --timeout-keep-alive 75 \
  --timeout-graceful-shutdown 20 \
  --no-server-header
