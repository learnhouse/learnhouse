#!/bin/sh
set -e

# Frontend entrypoint script
# This script starts the Next.js server with runtime environment variable injection

# Validate required environment variables (optional - can be set with defaults)
# NEXT_PUBLIC_* variables are injected at runtime by server-wrapper.js

# Set defaults if not provided
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"

# Start the Next.js server using the wrapper script
# The wrapper will inject NEXT_PUBLIC_* env vars before starting
# Using 'env' ensures all Kubernetes-injected environment variables are passed through
exec env node server-wrapper.js

