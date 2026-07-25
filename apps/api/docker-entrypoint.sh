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

# Extract host and port from connection strings if provided
if [ -n "$LEARNHOUSE_SQL_CONNECTION_STRING" ]; then
    # Extract host and port from postgresql://user:pass@host:port/db
    DB_HOST=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\1/p')
    DB_PORT=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\2/p')
    
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

echo "Starting LearnHouse backend on ${HOST}:${PORT}..."

# Start the FastAPI application.
# Calling the venv's uvicorn directly rather than `uv run` keeps a lockfile
# resolution out of the container start path (measured 574ms vs 54ms).
# The path is resolved relative to this script rather than hardcoded: the API
# image has the venv at /app/.venv, the all-in-one OSS image at /app/api/.venv.
# Falls back to `uv run` if no venv is found next to the script.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
UVICORN="$SCRIPT_DIR/.venv/bin/uvicorn"

if [ -x "$UVICORN" ]; then
    exec "$UVICORN" app:app --host "$HOST" --port "$PORT" --timeout-keep-alive 600
else
    echo "No venv at $UVICORN, falling back to uv run"
    exec uv run uvicorn app:app --host "$HOST" --port "$PORT" --timeout-keep-alive 600
fi

