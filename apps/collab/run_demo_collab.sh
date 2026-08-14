#!/bin/bash
# Local demo stack — collaboration server.
#
# Boards and the collaborative editor talk to this over a websocket. Without it
# a board never leaves "connecting", which looks like a broken feature rather
# than a missing service.
#
# Reads the same generated .demo-secrets as the API, so the JWT secret and
# internal key match without either file carrying signing material.
set -euo pipefail
cd "$(dirname "$0")"

SECRETS_FILE="../../.demo-secrets"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Start the API first (apps/api/run_demo_api.sh) — it generates $SECRETS_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS_FILE"
set +a

export COLLAB_PORT=4000
export LEARNHOUSE_API_URL="http://lvh.me:1348"
# LEARNHOUSE_REDIS_URL, not the API's LEARNHOUSE_REDIS_CONNECTION_STRING —
# src/index.ts reads a different name, so the wrong one silently falls back to
# the default and would point at the wrong Redis anywhere but here.
export LEARNHOUSE_REDIS_URL="redis://localhost:6379/0"

exec bun run start
