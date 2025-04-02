#!/bin/sh

pm2 start server.js --cwd /app/web --name learnhouse-web > /dev/null 2>&1

cd /app/api
pm2 start "uv run app.py" --name learnhouse-api > /dev/null 2>&1
cd /app

# Check if the services are running and log the status
pm2 status

# Start Nginx in the background
nginx -g 'daemon off;' &

# Tail Nginx error and access logs
pm2 logs
