#!/bin/bash
set -e

# Wait for services
wait_for_service() {
  local host=$1
  local port=$2
  local name=$3
  local max_attempts=30
  local attempt=1
  echo "Waiting for ${name} at ${host}:${port}..."
  while [ $attempt -le $max_attempts ]; do
    if nc -z "$host" "$port" 2>/dev/null || timeout 1 bash -c "cat < /dev/null > /dev/tcp/$host/$port" 2>/dev/null; then
      echo "${name} is ready"
      return 0
    fi
    echo "Attempt ${attempt}/${max_attempts}: ${name} not ready, sleeping 2s..."
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "Error: ${name} not ready in time"
  exit 1
}

if [ -n "$LEARNHOUSE_SQL_CONNECTION_STRING" ]; then
  DB_HOST=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\\([^:]*\\):\\([0-9]*\\)\\/.*/\\1/p')
  DB_PORT=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\\([^:]*\\):\\([0-9]*\\)\\/.*/\\2/p')
  DB_PORT=${DB_PORT:-5432}
  if [ -n "$DB_HOST" ]; then wait_for_service "$DB_HOST" "$DB_PORT" "PostgreSQL"; fi
fi

if [ -n "$LEARNHOUSE_REDIS_CONNECTION_STRING" ]; then
  REDIS_HOST=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\\([^:/]*\\):\\([0-9]*\\).*|\\1|p')
  REDIS_PORT=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\\([^:/]*\\):\\([0-9]*\\).*|\\2|p')
  REDIS_PORT=${REDIS_PORT:-6379}
  if [ -z "$REDIS_HOST" ]; then
    REDIS_HOST=$(echo "$LEARNHOUSE_REDIS_CONNECTION_STRING" | sed -n 's|redis://\\([^:/]*\\).*|\\1|p')
  fi
  if [ -n "$REDIS_HOST" ]; then wait_for_service "$REDIS_HOST" "$REDIS_PORT" "Redis"; fi
fi

export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

PORT=${LEARNHOUSE_PORT:-9000}
HOST=${HOSTNAME:-0.0.0.0}

echo "Starting LearnHouse backend on ${HOST}:${PORT}..."
exec uv run uvicorn app:app --host "$HOST" --port "$PORT"

