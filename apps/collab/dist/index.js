import 'dotenv/config';
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
const PORT = parseInt(process.env.COLLAB_PORT || '4000', 10);
const API_URL = process.env.LEARNHOUSE_API_URL || 'http://localhost:8000';
const SECRET_KEY = process.env.LEARNHOUSE_AUTH_JWT_SECRET_KEY || '';
const INTERNAL_KEY = process.env.COLLAB_INTERNAL_KEY || '';
const REDIS_URL = process.env.LEARNHOUSE_REDIS_URL || 'redis://localhost:6379';
// Debounce interval before flushing ydoc state to the database (ms)
const DB_FLUSH_DELAY = 5000;
// Redis TTL for cached ydoc state (seconds) — 1 hour
const REDIS_YDOC_TTL = 3600;
// ── Rate limiting ───────────────────────────────────────────────────────────
// Tracks connection attempts per IP to prevent brute-force/DoS
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // max connections per IP per window
const connectionAttempts = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const entry = connectionAttempts.get(ip);
    if (!entry || now >= entry.resetAt) {
        connectionAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}
// Clean up stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of connectionAttempts) {
        if (now >= entry.resetAt)
            connectionAttempts.delete(ip);
    }
}, 5 * 60_000);
function extractBoardUuid(documentName) {
    // Room naming: board:{board_uuid}
    const match = documentName.match(/^board:(.+)$/);
    return match ? match[1] : null;
}
// ── Redis connection ────────────────────────────────────────────────────────
let redis = null;
function getRedis() {
    if (!redis) {
        redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });
        redis.connect().catch((err) => {
            console.error('[collab] Redis connection failed:', err);
        });
    }
    return redis;
}
function redisYdocKey(boardUuid) {
    return `collab:ydoc:${boardUuid}`;
}
// ── Debounced DB persistence ────────────────────────────────────────────────
const pendingFlushes = new Map();
function scheduleDbFlush(boardUuid, state) {
    // Cancel any existing pending flush for this board
    const existing = pendingFlushes.get(boardUuid);
    if (existing)
        clearTimeout(existing);
    const timer = setTimeout(async () => {
        pendingFlushes.delete(boardUuid);
        try {
            const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'X-Internal-Key': INTERNAL_KEY,
                    'Content-Type': 'application/octet-stream',
                },
                body: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
            });
            if (!response.ok) {
                console.error(`[collab] DB flush failed for ${boardUuid}: ${response.status}`);
            }
        }
        catch (err) {
            console.error(`[collab] DB flush error for ${boardUuid}:`, err);
        }
    }, DB_FLUSH_DELAY);
    pendingFlushes.set(boardUuid, timer);
}
// ── Server ──────────────────────────────────────────────────────────────────
// Max concurrent users per board
const MAX_BOARD_USERS = 10;
const server = Server.configure({
    port: PORT,
    async onRequest({ request }) {
        // Rate limiting by IP
        const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            request.socket.remoteAddress ||
            'unknown';
        if (isRateLimited(ip)) {
            throw new Error('Too many connection attempts');
        }
    },
    async onAuthenticate({ token, documentName }) {
        if (!token) {
            throw new Error('Authentication required');
        }
        // Verify JWT using same secret + algorithm as backend
        let payload;
        try {
            payload = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] });
        }
        catch {
            throw new Error('Invalid token');
        }
        const boardUuid = extractBoardUuid(documentName);
        if (!boardUuid) {
            throw new Error('Invalid document name');
        }
        // Verify board membership via backend API
        const response = await fetch(`${API_URL}/api/v1/boards/${boardUuid}/membership`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            throw new Error('Not authorized for this board');
        }
        const membership = await response.json();
        return {
            user: {
                id: payload.sub,
                name: membership.username || 'Unknown',
                role: membership.role,
            },
        };
    },
    async onConnect({ documentName, instance }) {
        const boardUuid = extractBoardUuid(documentName);
        if (!boardUuid)
            return;
        // Count existing connections for this document
        const doc = instance.documents.get(documentName);
        if (doc && doc.getConnectionsCount() >= MAX_BOARD_USERS) {
            throw new Error(`Board is full (max ${MAX_BOARD_USERS} concurrent users)`);
        }
    },
    extensions: [
        new Database({
            async fetch({ documentName }) {
                const boardUuid = extractBoardUuid(documentName);
                if (!boardUuid)
                    return null;
                // 1. Try Redis first
                try {
                    const r = getRedis();
                    const cached = await r.getBuffer(redisYdocKey(boardUuid));
                    if (cached && cached.byteLength > 0) {
                        console.log(`[collab] Redis hit for ${boardUuid}: ${cached.byteLength} bytes`);
                        return new Uint8Array(cached);
                    }
                }
                catch (err) {
                    console.error(`[collab] Redis fetch error for ${boardUuid}:`, err);
                }
                // 2. Fall back to database
                try {
                    const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`;
                    console.log(`[collab] Fetching ydoc from DB for ${boardUuid}`);
                    const response = await fetch(url, {
                        headers: {
                            'X-Internal-Key': INTERNAL_KEY,
                        },
                    });
                    if (!response.ok) {
                        console.error(`[collab] Failed to fetch ydoc for ${boardUuid}: ${response.status} ${response.statusText}`);
                        return null;
                    }
                    const buffer = await response.arrayBuffer();
                    if (buffer.byteLength === 0)
                        return null;
                    const state = new Uint8Array(buffer);
                    console.log(`[collab] Fetched ydoc from DB for ${boardUuid}: ${buffer.byteLength} bytes`);
                    // Warm the Redis cache
                    try {
                        const r = getRedis();
                        await r.setex(redisYdocKey(boardUuid), REDIS_YDOC_TTL, Buffer.from(state));
                    }
                    catch (err) {
                        console.error(`[collab] Redis warm error for ${boardUuid}:`, err);
                    }
                    return state;
                }
                catch (err) {
                    console.error(`[collab] Error fetching ydoc for ${boardUuid}:`, err);
                    return null;
                }
            },
            async store({ documentName, state }) {
                const boardUuid = extractBoardUuid(documentName);
                if (!boardUuid)
                    return;
                // 1. Write to Redis immediately (fast)
                try {
                    const r = getRedis();
                    await r.setex(redisYdocKey(boardUuid), REDIS_YDOC_TTL, Buffer.from(state));
                }
                catch (err) {
                    console.error(`[collab] Redis store error for ${boardUuid}:`, err);
                }
                // 2. Debounced write to database (slow, batched)
                scheduleDbFlush(boardUuid, state);
            },
        }),
    ],
});
// Flush all pending writes on shutdown
async function gracefulShutdown() {
    console.log('[collab] Shutting down, flushing pending writes...');
    // Cancel debounce timers and flush immediately
    const flushPromises = [];
    for (const [boardUuid, timer] of pendingFlushes) {
        clearTimeout(timer);
        const flush = async () => {
            try {
                const r = getRedis();
                const cached = await r.getBuffer(redisYdocKey(boardUuid));
                if (cached && cached.byteLength > 0) {
                    const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`;
                    await fetch(url, {
                        method: 'PUT',
                        headers: {
                            'X-Internal-Key': INTERNAL_KEY,
                            'Content-Type': 'application/octet-stream',
                        },
                        body: cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength),
                    });
                    console.log(`[collab] Flushed ${boardUuid} to DB on shutdown`);
                }
            }
            catch (err) {
                console.error(`[collab] Shutdown flush error for ${boardUuid}:`, err);
            }
        };
        flushPromises.push(flush());
    }
    await Promise.allSettled(flushPromises);
    pendingFlushes.clear();
    if (redis) {
        await redis.quit();
    }
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
server.listen().then(() => {
    console.log(`Hocuspocus collab server running on port ${PORT}`);
});
