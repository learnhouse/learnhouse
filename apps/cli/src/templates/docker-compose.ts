import type { SetupConfig } from '../types.js'

/**
 * Generates docker-compose.yml with a unique deployment ID suffix
 * so multiple installations don't conflict on container names, volumes, or networks.
 */
export function generateDockerCompose(config: SetupConfig): string {
  const id = config.deploymentId

  return `version: "3.9"

name: learnhouse-${id}

services:
  learnhouse-app:
    image: ghcr.io/learnhouse/app:latest
    container_name: learnhouse-app-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # HOSTNAME needs to be set explicitly for the container
      - HOSTNAME=0.0.0.0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

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

  db:
    image: postgres:16-alpine
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

networks:
  learnhouse-network-${id}:
    driver: bridge

volumes:
  learnhouse_db_data_${id}:
  learnhouse_redis_data_${id}:
`
}
