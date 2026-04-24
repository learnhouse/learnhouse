#!/bin/sh

# Set environment variables for proper Python logging
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

# Wait for database and redis if connection strings point to external services
# (In docker-compose, depends_on handles this, but useful for standalone)
if [ -n "$LEARNHOUSE_SQL_CONNECTION_STRING" ]; then
    DB_HOST=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\1/p')
    if [ -n "$DB_HOST" ] && [ "$DB_HOST" != "localhost" ] && [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "db" ]; then
        echo "Waiting for external database at $DB_HOST..."
        timeout 30 sh -c 'until nc -z '"$DB_HOST"' 5432; do sleep 1; done' || true
    fi
fi

# Start the services
# Use server-wrapper.js for runtime environment variable injection
pm2 start server-wrapper.js --cwd /app/web --name learnhouse-web > /dev/null 2>&1
pm2 start uv --cwd /app/api --name learnhouse-api -- run app.py
pm2 start node --cwd /app/collab --name learnhouse-collab -- dist/index.js
# MCP forwards each caller's own API token to the API — it carries no
# credentials of its own. Binds to 127.0.0.1 so only the in-container nginx
# can reach it; nginx exposes it at /mcp.
pm2 start learnhouse-mcp --name learnhouse-mcp --interpreter none \
  --env LEARNHOUSE_API_URL=http://127.0.0.1:${LEARNHOUSE_PORT:-9000} \
  --env LEARNHOUSE_MCP_HOST=${LEARNHOUSE_MCP_HOST:-127.0.0.1} \
  --env LEARNHOUSE_MCP_PORT=${LEARNHOUSE_MCP_PORT:-8765} \
  --env LEARNHOUSE_MCP_MOUNT_PATH=/mcp

# Check if the services are running and log the status
pm2 status

# Start Nginx in the background
nginx -g 'daemon off;' &

# Tail PM2 logs with proper formatting
pm2 logs --raw
