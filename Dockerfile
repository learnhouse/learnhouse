# ───────────────────────────────────────────────
# Stage 1: Frontend dependency install
# ───────────────────────────────────────────────
FROM node:22-alpine AS frontend-deps
RUN apk update && apk add --no-cache libc6-compat && rm -rf /var/cache/apk/*
WORKDIR /app

COPY apps/web/package.json apps/web/pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm i --frozen-lockfile

# ───────────────────────────────────────────────
# Stage 2: Frontend build
# ───────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY apps/web .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Remove .env files to avoid leaking secrets into the build
RUN rm -f .env*

RUN corepack enable pnpm && pnpm run build

# ───────────────────────────────────────────────
# Stage 3: Frontend production image
# ───────────────────────────────────────────────
FROM node:22-alpine AS frontend-runner
WORKDIR /app

RUN apk update && apk add --no-cache curl && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=frontend-builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

# Leverage output traces to reduce image size
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy server wrapper for runtime environment variable injection
COPY --chown=nextjs:nodejs apps/web/server-wrapper.js ./
RUN chmod +x server-wrapper.js

# ───────────────────────────────────────────────
# Stage 4: Final image combining frontend + backend
# ───────────────────────────────────────────────
FROM python:3.14.2-slim-bookworm AS runner

# Single apt layer: nginx, curl, netcat, node, pm2
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl netcat-openbsd ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pm2 \
    && apt-get purge -y gnupg \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm \
    && rm /etc/nginx/sites-enabled/default

# Copy the frontend standalone build
COPY --from=frontend-runner /app /app/web

# Backend: install deps first (better layer caching)
WORKDIR /app/api
COPY ./apps/api/uv.lock ./apps/api/pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip uv \
    && uv sync --no-dev
COPY ./apps/api ./

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/api/ee; fi

# Copy configs and scripts
WORKDIR /app
COPY ./extra/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./apps/api/docker-entrypoint.sh /app/api/docker-entrypoint.sh
COPY ./extra/start.sh /app/start.sh
RUN chmod +x /app/api/docker-entrypoint.sh /app/start.sh

ENV PORT=8000 LEARNHOUSE_PORT=9000 HOSTNAME=0.0.0.0 LEARNHOUSE_OSS=true NEXT_PUBLIC_LEARNHOUSE_OSS=true

EXPOSE 80 9000

CMD ["sh", "/app/start.sh"]
