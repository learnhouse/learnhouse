/**
 * Generates nginx.prod.conf for the external reverse proxy.
 * All traffic (including /collab WebSocket) goes to the app container,
 * which has its own internal nginx routing.
 */
export function generateNginxConf(): string {
  return `
server {
    listen 80;
    listen [::]:80;
    server_name _;
    # Must match the app container's internal nginx (6G). A lower value here
    # makes the outer proxy reject large uploads (e.g. videos) with a 413
    # before the request ever reaches the app — see docker/nginx.conf.
    client_max_body_size 6G;

    # Increase header buffer size
    large_client_header_buffers 4 32k;

    # Increase the maximum allowed size of the client request body
    client_body_buffer_size 32k;

    # Increase the maximum allowed size of the client request header fields
    client_header_buffer_size 32k;

    # Proxy all requests to the learnhouse-app service
    # The app container has internal nginx routing between frontend, backend, and collab
    location / {
        proxy_pass http://learnhouse-app:80;
        # Use $http_host (not $host) so the port is preserved — Next.js Server
        # Actions reject POSTs where origin and x-forwarded-host disagree.
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (needed for /collab)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for long-running requests and WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 75s;
    }
}
`
}
