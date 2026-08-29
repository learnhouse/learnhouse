#!/bin/bash
set -e

# Backend entrypoint script
# This script waits for dependencies and starts the FastAPI application

# Function to wait for a service to be ready
wait_for_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local max_attempts=30
    local attempt=1

    echo "Waiting for ${service_name} to be ready at ${host}:${port}..."
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z "$host" "$port" 2>/dev/null || timeout 1 bash -c "cat < /dev/null > /dev/tcp/$host/$port" 2>/dev/null; then
            echo "${service_name} is ready!"
            return 0
        fi
        echo "Attempt ${attempt}/${max_attempts}: ${service_name} not ready, waiting 2 seconds..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "Error: ${service_name} did not become ready in time"
    exit 1
}

# The venv path is resolved relative to this script rather than hardcoded: the
# API image has the venv at /app/.venv, the all-in-one OSS image at
# /app/api/.venv. Both alembic and uvicorn are called from there directly —
# going through `uv run` would resolve the lockfile on every container start
# (measured 574ms vs 54ms).
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
UVICORN="$SCRIPT_DIR/.venv/bin/uvicorn"
ALEMBIC="$SCRIPT_DIR/.venv/bin/alembic"
PYTHON="$SCRIPT_DIR/.venv/bin/python"

# Resolve the database URL exactly the way the application does.
#
# config/config.py reads `LEARNHOUSE_SQL_CONNECTION_STRING or config.yaml ->
# database_config.sql_connection_string`, and config/config.yaml is tracked and
# copied into the image, so a deployment can be configured entirely through the
# yaml with the env var never set. Keying off the env var alone here (and in
# migrations/env.py) meant such a deployment skipped the port wait and then ran
# `alembic upgrade head` against the yaml's localhost fallback.
DB_URL="$LEARNHOUSE_SQL_CONNECTION_STRING"
if [ -z "$DB_URL" ] && [ -x "$PYTHON" ] && [ -f "$SCRIPT_DIR/config/config.yaml" ]; then
    DB_URL=$("$PYTHON" -c "
import sys, yaml
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        cfg = yaml.safe_load(f) or {}
    print((cfg.get('database_config') or {}).get('sql_connection_string') or '')
except Exception:
    print('')
" "$SCRIPT_DIR/config/config.yaml" 2>/dev/null) || DB_URL=""
fi

# Extract host and port from connection strings if provided
if [ -n "$DB_URL" ]; then
    # Extract host and port from postgresql://user:pass@host:port/db
    DB_HOST=$(echo "$DB_URL" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\1/p')
    DB_PORT=$(echo "$DB_URL" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\2/p')

    if [ -z "$DB_PORT" ]; then
        DB_PORT=5432
    fi
    
    if [ -n "$DB_HOST" ]; then
        wait_for_service "$DB_HOST" "$DB_PORT" "PostgreSQL"
    fi
fi

if [ -n "$LEARNHOUSE_REDIS_CONNECTION_STRING" ]; then
    # Extract host and port from redis://host:port/db or redis://host:port
    REDIS_HOST=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\([^:/]*\):\([0-9]*\).*|\1|p')
    REDIS_PORT=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\([^:/]*\):\([0-9]*\).*|\2|p')
    
    if [ -z "$REDIS_PORT" ]; then
        REDIS_PORT=6379
    fi
    
    if [ -z "$REDIS_HOST" ]; then
        # Try default format redis://host:port
        REDIS_HOST=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\([^:/]*\).*|\1|p')
    fi
    
    if [ -n "$REDIS_HOST" ]; then
        wait_for_service "$REDIS_HOST" "$REDIS_PORT" "Redis"
    fi
fi

# Set Python environment variables
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

# Get port from config or use default
PORT=${LEARNHOUSE_PORT:-9000}
HOST=${HOSTNAME:-0.0.0.0}

# Apply database migrations before serving.
#
# Nothing used to run alembic anywhere in the deploy path: the schema was
# created solely by SQLModel.metadata.create_all at startup, which only ever
# issues CREATE TABLE. It never ALTERs an existing table, so a column added by
# a migration stayed invisible to it and the first query touching that column
# raised UndefinedColumnError inside the lifespan handler — an unservable pod
# in a crash loop, discovered at runtime instead of at deploy time.
#
# Concurrent replicas are safe: migrations/env.py takes a Postgres advisory
# lock, so the first pod migrates and the rest wait and then find themselves
# already at head. `set -e` means a failed migration aborts the boot, which is
# the point — a pod on a stale schema serves nothing but 500s.
#
# Set LEARNHOUSE_RUN_MIGRATIONS=false where an external Job owns migrations.
#
# The step is retried, for the same reason src/core/events/database.py retries
# its startup connect: a saturated pooler ("max clients reached in session
# mode"), a rolling database restart or a network blip is transient, and under
# `set -e` a single one of those would kill the pod, which then restarts and
# opens another connection against the pooler that is already out of clients.
# `alembic upgrade head` is idempotent and serialized by the advisory lock in
# migrations/env.py, so retrying it is safe. Each attempt is also bounded by
# `timeout` so a hung connection cannot stall the pod past its startup probe.
#
# The three knobs below are validated, because a typo in one must only change
# the step's TIMING, never whether it runs. `[ "$migration_attempt" -le
# "$MIGRATION_ATTEMPTS" ]` with a non-numeric right-hand side prints
# "integer expression expected" AND returns non-zero, so with
# LEARNHOUSE_MIGRATION_ATTEMPTS=abc the loop body never executes once: alembic
# is never invoked at all, migration_ok stays 0, and the pod exits 1 reporting
# "failed after abc attempts" — a bricked boot that lies about the cause.
# `timeout abc` fails the same way, on every attempt. `:-` only substitutes an
# UNSET or empty value, so it catches none of this.
bounded_int() {
    # $1 raw value, $2 default, $3 minimum, $4 maximum, $5 name (for the log)
    case "$1" in
        *[!0-9]*|"") ;;
        *)
            # Length-capped before any arithmetic: a 20-digit value would wrap
            # in bash's 64-bit math and could land back inside the range.
            if [ "${#1}" -le 6 ]; then
                # 10# so a leading zero is not read as octal.
                bounded_value=$((10#$1))
                if [ "$bounded_value" -ge "$3" ] && [ "$bounded_value" -le "$4" ]; then
                    echo "$bounded_value"
                    return 0
                fi
            fi
            ;;
    esac
    echo "Warning: $5=$1 is not an integer in [$3, $4] — using $2 instead." >&2
    echo "$2"
}

MIGRATION_ATTEMPTS=$(bounded_int "${LEARNHOUSE_MIGRATION_ATTEMPTS:-5}" 5 1 100 LEARNHOUSE_MIGRATION_ATTEMPTS)
MIGRATION_BACKOFF=$(bounded_int "${LEARNHOUSE_MIGRATION_BACKOFF:-2}" 2 0 3600 LEARNHOUSE_MIGRATION_BACKOFF)
MIGRATION_TIMEOUT=$(bounded_int "${LEARNHOUSE_MIGRATION_TIMEOUT:-600}" 600 1 86400 LEARNHOUSE_MIGRATION_TIMEOUT)

# This all runs BEFORE app.py calls sentry_sdk.init, so a failure here would
# otherwise be invisible outside `kubectl logs` — the boot failure would look
# like the crash-loop going quiet. Best-effort: never let reporting change the
# exit code.
report_migration_failure() {
    local detail=$1
    [ -x "$PYTHON" ] || return 0
    (cd "$SCRIPT_DIR" && "$PYTHON" -c "
import sys
try:
    from config.config import get_learnhouse_config
    import sentry_sdk
    cfg = get_learnhouse_config()
    dsn = cfg.general_config.sentry_config.dsn
    if not dsn:
        sys.exit(0)
    sentry_sdk.init(dsn=dsn, environment=cfg.general_config.env, send_default_pii=False)
    sentry_sdk.capture_message(
        'Database migrations failed during container startup: ' + sys.argv[1],
        level='error',
    )
    sentry_sdk.flush(timeout=5)
except Exception:
    pass
" "$detail") >/dev/null 2>&1 || true
}

if [ "${LEARNHOUSE_RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "Applying database migrations (alembic upgrade head)..."

    if [ -x "$ALEMBIC" ]; then
        MIGRATE_CMD=("$ALEMBIC" upgrade head)
    else
        echo "No venv at $ALEMBIC, falling back to uv run"
        MIGRATE_CMD=(uv run alembic upgrade head)
    fi

    # `timeout` is coreutils and present in both images, but degrade to running
    # alembic bare rather than failing every attempt if it ever is not.
    if command -v timeout >/dev/null 2>&1; then
        TIMEOUT_PREFIX=(timeout "$MIGRATION_TIMEOUT")
    else
        TIMEOUT_PREFIX=()
    fi

    migration_attempt=1
    migration_ok=0
    migration_status=1
    while [ "$migration_attempt" -le "$MIGRATION_ATTEMPTS" ]; do
        # `set -e` must not abort on a retryable attempt, hence the explicit if.
        # The status has to be read in the `else` branch: after `fi`, `$?` is the
        # exit status of the `if` compound itself (0), not of the condition.
        if (cd "$SCRIPT_DIR" && "${TIMEOUT_PREFIX[@]}" "${MIGRATE_CMD[@]}"); then
            migration_ok=1
            break
        else
            migration_status=$?
        fi
        # 78 is EX_CONFIG, raised by migrations/env.py for a failure no retry can
        # fix (an unstamped database, a connection alembic must not be handed).
        # Retrying it just prints the same instruction five times.
        if [ "$migration_status" -eq 78 ]; then
            echo "Migration failed with a permanent configuration error — not retrying."
            break
        fi
        if [ "$migration_attempt" -ge "$MIGRATION_ATTEMPTS" ]; then
            break
        fi
        delay=$((MIGRATION_BACKOFF * migration_attempt))
        echo "Migration attempt ${migration_attempt}/${MIGRATION_ATTEMPTS} failed (exit ${migration_status}); retrying in ${delay}s..."
        sleep "$delay"
        migration_attempt=$((migration_attempt + 1))
    done

    if [ "$migration_ok" -ne 1 ]; then
        echo "Error: 'alembic upgrade head' failed after ${MIGRATION_ATTEMPTS} attempts — refusing to start on an unmigrated schema."
        report_migration_failure "alembic upgrade head failed after ${MIGRATION_ATTEMPTS} attempts (last exit ${migration_status})"
        exit 1
    fi

    echo "Database migrations applied."
else
    echo "LEARNHOUSE_RUN_MIGRATIONS is not 'true' — skipping alembic upgrade head."
fi

# Start the FastAPI application.
echo "Starting LearnHouse backend on ${HOST}:${PORT}..."

if [ -x "$UVICORN" ]; then
    exec "$UVICORN" app:app --host "$HOST" --port "$PORT" --timeout-keep-alive 600
else
    echo "No venv at $UVICORN, falling back to uv run"
    exec uv run uvicorn app:app --host "$HOST" --port "$PORT" --timeout-keep-alive 600
fi

