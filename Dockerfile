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
RUN apk add --no-cache libc6-compat
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

# Set environment variables for the build
ENV NEXT_PUBLIC_LEARNHOUSE_API_URL=http://localhost/api/v1/
ENV NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost/
ENV NEXT_PUBLIC_LEARNHOUSE_DOMAIN=localhost

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

# Install curl 
RUN apk add --no-cache curl

ENV NODE_ENV production
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

# Run the backend
WORKDIR /app
COPY ./extra/nginx.conf /etc/nginx/conf.d/default.conf
ENV PORT=8000 LEARNHOUSE_PORT=9000 HOSTNAME=0.0.0.0
COPY ./extra/start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["sh", "/app/start.sh"]