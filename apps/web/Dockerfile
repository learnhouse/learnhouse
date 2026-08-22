FROM oven/bun:1.3.14-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk update && apk add --no-cache libc6-compat && rm -rf /var/cache/apk/*
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Rebuild the source code only when needed.
#
# Bun installs the dependencies, but Node runs the build. `bun run build`
# completes the Next build and then segfaults during process teardown (bun
# 1.3.14), which surfaces as exit 139 and fails the image even though the
# output is already written. Node is the runtime the production stage below
# uses anyway. Same change as the root Dockerfile, which the community images
# build from; this one is what the SaaS, PR and Enterprise frontend images use.
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk update && apk add --no-cache libc6-compat && rm -rf /var/cache/apk/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN rm -f .env*

# Remove Enterprise Edition folder for public/OSS builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/ee; fi

RUN node node_modules/next/dist/bin/next build

# Production image — use Node for the Next.js standalone server
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk update && apk add --no-cache curl && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --chown=nextjs:nodejs server-wrapper.js ./
RUN chmod +x server-wrapper.js

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN rm -f public/runtime-config.js && touch runtime-config.json && chown nextjs:nodejs runtime-config.json

USER nextjs

EXPOSE 3000

ENV PORT=3000

ENTRYPOINT ["./docker-entrypoint.sh"]
