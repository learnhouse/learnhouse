# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S collab && adduser -S collab -u 1001

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# All config via env vars — no .env file baked in
ENV NODE_ENV=production
ENV COLLAB_PORT=4000

EXPOSE 4000

USER collab

CMD ["node", "dist/index.js"]
