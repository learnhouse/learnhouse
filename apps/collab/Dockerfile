# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1.4.0-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

RUN bun run build

# ── Production stage ────────────────────────────────────────────────────────
# Bun builds this, but Node runs it. @hocuspocus/server constructs crossws'
# Node adapter unconditionally, and that adapter throws on sight of Bun:
#   if ("Deno" in globalThis || "Bun" in globalThis) throw new Error(
#     "[crossws] Using Node.js adapter in an incompatible environment.")
# Measured on bun 1.4.0: the process dies at `new Server()` before it listens.
# Revisit when @hocuspocus/server picks its adapter at runtime.
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
