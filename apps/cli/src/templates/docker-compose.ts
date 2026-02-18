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
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:80/ || exit 1"]
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
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
`

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
${appDependsOn}
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
${proxyService}${dbService}${redisService}
networks:
  learnhouse-network-${id}:
    driver: bridge

${volumesSection}
`
}
