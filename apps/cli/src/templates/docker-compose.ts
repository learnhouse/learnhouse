import { APP_IMAGE, POSTGRES_IMAGE, POSTGRES_AI_IMAGE } from '../constants.js'
import type { SetupConfig } from '../types.js'

/**
 * Generates docker-compose.yml with unique deployment ID.
 * External database/redis excluded. Auto SSL uses Caddy instead of nginx.
 */
export function generateDockerCompose(config: SetupConfig, appImage?: string): string {
  const image = appImage || APP_IMAGE
  const id = config.deploymentId
  const useLocalDb = !config.useExternalDb
  const useLocalRedis = !config.useExternalRedis

  const deps: string[] = []
  if (useLocalDb) deps.push('      db:\n        condition: service_healthy')
  if (useLocalRedis) deps.push('      redis:\n        condition: service_healthy')

  const appDependsOn = deps.length > 0
    ? `    depends_on:\n${deps.join('\n')}`
    : ''

  const proxyService = config.autoSsl
    ? `
  caddy:
    image: caddy:2-alpine
    container_name: learnhouse-caddy-${id}
    restart: unless-stopped
    ports:
      - "80:80"
      - "\${HTTP_PORT:-443}:443"
    volumes:
      - ./extra/Caddyfile:/etc/caddy/Caddyfile:ro
      - learnhouse_caddy_data_${id}:/data
      - learnhouse_caddy_config_${id}:/config
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      # Use 127.0.0.1 — alpine's wget tries IPv6 first and Caddy only binds v4 by default
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
`
    : `
  nginx:
    image: nginx:alpine
    container_name: learnhouse-nginx-${id}
    restart: unless-stopped
    ports:
      - "\${HTTP_PORT:-80}:80"
    volumes:
      - ./extra/nginx.prod.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      # Use 127.0.0.1 — alpine's wget resolves localhost to IPv6 first, but nginx only listens on v4 by default
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
`

  // When the public HTTP port is not 80, Next.js SSR fetches inside the app
  // container hit `localhost:${HTTP_PORT}` which has nothing listening — only
  // the container's internal nginx on port 80 serves the same routes. We add
  // a tiny socat sidecar that shares the app container's network namespace
  // and forwards `localhost:${HTTP_PORT}` → `localhost:80`, making SSR work
  // identically to a port-80 deployment without rebuilding the app image.
  // Skipped when HTTP_PORT=80 (would clash with internal nginx) and when
  // auto-SSL/HTTPS is in use (the public URL is HTTPS and goes through Caddy).
  const needsSsrPortForward = !config.autoSsl && !config.useHttps && config.httpPort !== 80
  const ssrForwardService = needsSsrPortForward
    ? `
  ssr-fwd:
    image: alpine/socat:1.8.0.0
    container_name: learnhouse-ssr-fwd-${id}
    restart: unless-stopped
    network_mode: "service:learnhouse-app"
    command: TCP-LISTEN:${config.httpPort},fork,reuseaddr TCP:localhost:80
    depends_on:
      learnhouse-app:
        condition: service_healthy
`
    : ''

  const dbImage = config.useAiDatabase ? POSTGRES_AI_IMAGE : POSTGRES_IMAGE
  const dbService = useLocalDb
    ? `
  db:
    image: ${dbImage}
    container_name: learnhouse-db-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-learnhouse}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-learnhouse}
      - POSTGRES_DB=\${POSTGRES_DB:-learnhouse}
    volumes:
      - learnhouse_db_data_${id}:/var/lib/postgresql/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-learnhouse}"]
      interval: 5s
      timeout: 4s
      retries: 5
`
    : ''

  const redisService = useLocalRedis
    ? `
  redis:
    image: redis:7.2.3-alpine
    container_name: learnhouse-redis-${id}
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - learnhouse_redis_data_${id}:/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 4s
      retries: 5
`
    : ''

  const volumeEntries: string[] = []
  if (config.autoSsl) {
    volumeEntries.push(`  learnhouse_caddy_data_${id}:`)
    volumeEntries.push(`  learnhouse_caddy_config_${id}:`)
  }
  if (useLocalDb) volumeEntries.push(`  learnhouse_db_data_${id}:`)
  if (useLocalRedis) volumeEntries.push(`  learnhouse_redis_data_${id}:`)

  const volumesSection = volumeEntries.length > 0
    ? `volumes:\n${volumeEntries.join('\n')}`
    : ''

  return `name: learnhouse-${id}

services:
  learnhouse-app:
    image: ${image}
    container_name: learnhouse-app-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # HOSTNAME needs to be set explicitly for the container
      - HOSTNAME=0.0.0.0
      - LEARNHOUSE_API_URL=http://localhost:9000
${appDependsOn}
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
${proxyService}${ssrForwardService}${dbService}${redisService}
networks:
  learnhouse-network-${id}:
    driver: bridge

${volumesSection}
`
}
