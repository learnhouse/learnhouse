#!/bin/sh

# Start the services
pm2 start server.js --cwd /app/web --name learnhouse-web > /dev/null 2>&1
pm2 start app.py --cwd /app/api --name learnhouse-api > /dev/null 2>&1

# Check if the services are running qnd log the status
pm2 status

# Start Nginx in the background
nginx -g 'daemon off;' &

# Tail Nginx error and access logs
pm2 logs