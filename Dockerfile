# Base image for Python backend
FROM python:3.12.3-slim-bookworm AS base

# Install Nginx, curl, and build-essential
RUN apt update && apt install -y nginx curl build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/nginx/sites-enabled/default

# Install Node tools
RUN curl -fsSL https://deb.nodesource.com/setup_21.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pm2

# Frontend Build - Using Node.js Alpine for better performance
FROM node:22-alpine AS frontend-base

# Install dependencies only when needed
FROM frontend-base AS frontend-deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk update && apk add --no-cache libc6-compat && rm -rf /var/cache/apk/*
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY apps/web/package.json apps/web/pnpm-lock.yaml* ./
RUN \
  if [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM frontend-base AS frontend-builder
WORKDIR /app
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY apps/web .



# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

# Remove .env files from the final image
# This is a good practice to avoid leaking sensitive data
# Learn more about it in the Next.js documentation: https://nextjs.org/docs/basic-features/environment-variables
RUN rm -f .env*

RUN \
  if [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM frontend-base AS frontend-runner
WORKDIR /app

# Install curl for health checks
RUN apk update && apk add --no-cache curl && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=frontend-builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy server wrapper for runtime environment variable injection
COPY --chown=nextjs:nodejs apps/web/server-wrapper.js ./
RUN chmod +x server-wrapper.js

# Final image combining frontend and backend
FROM base AS runner

# Copy the frontend standalone build
COPY --from=frontend-runner /app /app/web

# Backend Build
WORKDIR /app/api
COPY ./apps/api/uv.lock ./
COPY ./apps/api/pyproject.toml ./
RUN pip install --upgrade pip \
    && pip install uv \
    && uv sync
COPY ./apps/api ./

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/api/ee; fi

# Install curl and netcat for health checks and service waiting
RUN apt-get update && apt-get install -y curl netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Run the backend
WORKDIR /app
COPY ./extra/nginx.conf /etc/nginx/conf.d/default.conf
ENV PORT=8000 LEARNHOUSE_PORT=9000 HOSTNAME=0.0.0.0

# Copy entrypoint scripts
COPY ./apps/api/docker-entrypoint.sh /app/api/docker-entrypoint.sh
RUN chmod +x /app/api/docker-entrypoint.sh

COPY ./extra/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Expose ports
EXPOSE 80 9000

CMD ["sh", "/app/start.sh"]