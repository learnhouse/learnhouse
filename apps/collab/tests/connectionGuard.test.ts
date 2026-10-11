import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Server } from '@hocuspocus/server'
import type { onAuthenticatePayload, onUpgradePayload } from '@hocuspocus/server'
import * as encoding from 'lib0/encoding'
import {
  CONNECTION_ID_HEADER,
  type ConnectionGuardOptions,
  createConnectionGuard,
  isPrivateAddress,
} from '../src/connectionGuard.ts'

const DOC = 'board:board_00000000-0000-0000-0000-000000000000'

const defaults: ConnectionGuardOptions = {
  trustProxy: true, // so loopback test clients get their own bucket
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
  maxConnectionsPerIp: 100,
  maxPendingConnections: 100,
  authDeadlineMs: 300,
  preAuthMaxBytes: 4096,
}

const servers: Server[] = []
after(async () => {
  await Promise.all(servers.map((s) => s.destroy()))
})

async function startServer(overrides: Partial<ConnectionGuardOptions> = {}) {
  const guard = createConnectionGuard({ ...defaults, ...overrides })
  const server = new Server({
    port: 0,
    quiet: true,
    stopOnSignals: false,
    async onUpgrade({ request, socket }: onUpgradePayload) {
      // eslint-disable-next-line no-throw-literal
      if (!guard.admit(request, socket)) throw null
    },
    async onAuthenticate({ token, requestHeaders }: onAuthenticatePayload) {
      if (token !== 'valid') throw new Error('Invalid token')
      guard.markAuthenticated(requestHeaders.get(CONNECTION_ID_HEADER))
    },
  })
  await server.listen()
  servers.push(server)
  return { url: `ws://127.0.0.1:${server.address.port}`, guard }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('upgrade refused'))
  })
}

function closed(ws: WebSocket, withinMs: number): Promise<boolean> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), withinMs)
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function authMessage(token: string): Uint8Array {
  const enc = encoding.createEncoder()
  encoding.writeVarString(enc, DOC)
  encoding.writeVarUint(enc, 2) // MessageType.Auth
  encoding.writeVarUint(enc, 0) // AuthMessageType.Token
  encoding.writeVarString(enc, token)
  return encoding.toUint8Array(enc)
}

/** A message for the document that is not an auth message, so it gets queued. */
function filler(bytes: number): Uint8Array {
  const enc = encoding.createEncoder()
  encoding.writeVarString(enc, DOC)
  encoding.writeVarUint(enc, 1) // MessageType.Awareness
  encoding.writeVarUint8Array(enc, new Uint8Array(bytes))
  return encoding.toUint8Array(enc)
}

async function authenticate(ws: WebSocket, token = 'valid') {
  const reply = new Promise<void>((resolve) => {
    ws.addEventListener('message', () => resolve(), { once: true })
  })
  ws.send(authMessage(token))
  await reply
}

describe('connection guard', () => {
  it('closes a socket that never authenticates', async () => {
    const { url, guard } = await startServer()
    const ws = await connect(url)
    assert.equal(guard.pendingCount, 1)
    assert.equal(await closed(ws, 2000), true)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(guard.pendingCount, 0)
  })

  it('closes a socket that sends too much before authenticating', async () => {
    const { url } = await startServer({ authDeadlineMs: 10_000 })
    const ws = await connect(url)
    for (let i = 0; i < 4; i++) ws.send(filler(2048))
    assert.equal(await closed(ws, 2000), true)
  })

  it('lets a socket queue messages within the budget while authenticating', async () => {
    const { url } = await startServer({ authDeadlineMs: 10_000 })
    const ws = await connect(url)
    ws.send(filler(2048))
    assert.equal(await closed(ws, 500), false)
    ws.close()
  })

  it('keeps an authenticated socket open past the deadline and budget', async () => {
    const { url, guard } = await startServer()
    const ws = await connect(url)
    await authenticate(ws)
    assert.equal(guard.pendingCount, 0)
    for (let i = 0; i < 4; i++) ws.send(filler(2048))
    assert.equal(await closed(ws, 800), false)
    ws.close()
  })

  it('still enforces the deadline after a rejected token', async () => {
    const { url } = await startServer()
    const ws = await connect(url)
    await authenticate(ws, 'wrong')
    assert.equal(await closed(ws, 2000), true)
  })

  it('caps concurrent sockets per IP and frees the slot on close', async () => {
    const { url } = await startServer({ maxConnectionsPerIp: 2, authDeadlineMs: 10_000 })
    const a = await connect(url)
    const b = await connect(url)
    await assert.rejects(connect(url), /upgrade refused/)
    a.close()
    await closed(a, 1000)
    await new Promise((r) => setTimeout(r, 50))
    const c = await connect(url)
    b.close()
    c.close()
  })

  it('rate limits upgrades per IP', async () => {
    const { url } = await startServer({ rateLimitMax: 2, authDeadlineMs: 10_000 })
    const sockets = [await connect(url), await connect(url)]
    await assert.rejects(connect(url), /upgrade refused/)
    sockets.forEach((ws) => ws.close())
  })

  it('caps unauthenticated sockets globally', async () => {
    const { url } = await startServer({ maxPendingConnections: 1, authDeadlineMs: 10_000 })
    const a = await connect(url)
    await assert.rejects(connect(url), /upgrade refused/)
    await authenticate(a)
    const b = await connect(url)
    a.close()
    b.close()
  })

  it('skips per-IP limits for a private peer when no proxy is trusted', async () => {
    const { url } = await startServer({
      trustProxy: false,
      maxConnectionsPerIp: 1,
      authDeadlineMs: 10_000,
    })
    const a = await connect(url)
    const b = await connect(url)
    a.close()
    b.close()
  })
})

describe('isPrivateAddress', () => {
  it('recognizes loopback and private ranges', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', 'fd00::1', 'fe80::1']) {
      assert.equal(isPrivateAddress(ip), true, ip)
    }
  })

  it('treats public addresses as clients', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '2001:db8::1', '::ffff:8.8.8.8']) {
      assert.equal(isPrivateAddress(ip), false, ip)
    }
  })
})
