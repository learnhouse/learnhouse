# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

RUN bun run build

# ── Production stage ────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S collab && adduser -S collab -u 1001

COPY package.json bun.lock* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV COLLAB_PORT=4000

EXPOSE 4000

USER collab

CMD ["node", "dist/index.js"]
