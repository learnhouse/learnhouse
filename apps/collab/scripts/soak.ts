// Soak test for activity rooms against a running collab server + API.
//
// N headless HocuspocusProvider clients make random concurrent edits (text
// inserts and deletes, bold/italic formatting, block inserts and removals)
// for DURATION seconds. Then it checks that every client converged to the
// same document and that the content the API persisted is that document,
// and reports remote-apply latency (edit made on one client -> applied on
// another, through the server).
//
//   COLLAB_URL=ws://localhost:4000 API_URL=http://localhost:1377 \
//   COLLAB_INTERNAL_KEY=... SOAK_TOKEN_FILE=/path/to/jwt \
//   SOAK_ACTIVITY=activity_... SOAK_CLIENTS=10 SOAK_SECONDS=60 bun run soak
//
// All clients share this process (and its event loop), so the latencies are
// an upper bound of what separate browsers see.

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { FRAGMENT_NAME, canonicalize, type PMNode, yDocToProsemirrorJSON } from '../src/prosemirrorY.js'

const COLLAB_URL = process.env.COLLAB_URL || 'ws://localhost:4000'
const API_URL = process.env.API_URL || 'http://localhost:1377'
const INTERNAL_KEY = process.env.COLLAB_INTERNAL_KEY || ''
const ACTIVITY = process.env.SOAK_ACTIVITY || ''
const TOKEN = fs.readFileSync(process.env.SOAK_TOKEN_FILE || '', 'utf8').trim()
const CLIENTS = Number(process.env.SOAK_CLIENTS || 10)
const SECONDS = Number(process.env.SOAK_SECONDS || 60)
// Mean delay between two edits of one client (ms): ~5 edits/s each
const EDIT_INTERVAL_MS = Number(process.env.SOAK_EDIT_INTERVAL_MS || 200)
const SEED = Number(process.env.SOAK_SEED || 42)

if (!ACTIVITY || !TOKEN || !INTERNAL_KEY) {
  console.error('SOAK_ACTIVITY, SOAK_TOKEN_FILE and COLLAB_INTERNAL_KEY are required')
  process.exit(2)
}

// Deterministic PRNG (mulberry32) so a failing run can be replayed
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'kite', 'store', 'refund', 'order', 'ship', 'sale', ' ', ' ', '. ']

interface Client {
  index: number
  ydoc: Y.Doc
  provider: HocuspocusProvider
  random: () => number
  ops: Record<string, number>
}

// Latency bookkeeping: for each sender, the clock after each edit and when it was made
const sent = new Map<number, Array<{ clock: number; t: number; pending: number }>>()
const latencies: number[] = []

function recordSend(client: Client) {
  const clock = Y.getState(client.ydoc.store, client.ydoc.clientID)
  const list = sent.get(client.ydoc.clientID) ?? []
  list.push({ clock, t: performance.now(), pending: CLIENTS - 1 })
  sent.set(client.ydoc.clientID, list)
}

function onRemoteUpdate(receiver: Y.Doc) {
  const now = performance.now()
  for (const [senderId, list] of sent) {
    if (senderId === receiver.clientID) continue
    const have = Y.getState(receiver.store, senderId)
    for (const op of list) {
      if (op.clock > have) break
      const key = `${receiver.clientID}`
      const seen = (op as any).seen ?? ((op as any).seen = new Set<string>())
      if (seen.has(key)) continue
      seen.add(key)
      latencies.push(now - op.t)
      op.pending--
    }
    // Drop ops every receiver applied
    while (list.length && list[0].pending <= 0) list.shift()
  }
}

function blocks(doc: Y.Doc): Y.XmlElement[] {
  return doc.getXmlFragment(FRAGMENT_NAME).toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
}

function textOf(el: Y.XmlElement): Y.XmlText | null {
  const first = el.toArray().find((c) => c instanceof Y.XmlText)
  return (first as Y.XmlText) ?? null
}

function newBlock(random: () => number): Y.XmlElement {
  const heading = random() < 0.2
  const el = new Y.XmlElement(heading ? 'heading' : 'paragraph')
  if (heading) el.setAttribute('level', 2 as any)
  const text = new Y.XmlText()
  text.insert(0, `${WORDS[Math.floor(random() * WORDS.length)]} `)
  el.insert(0, [text])
  return el
}

/** One random edit, applied as one local transaction. */
function randomEdit(client: Client) {
  const { ydoc, random } = client
  const fragment = ydoc.getXmlFragment(FRAGMENT_NAME)
  const list = blocks(ydoc)
  const roll = random()
  ydoc.transact(() => {
    if (list.length === 0 || roll < 0.08) {
      // Insert a block somewhere
      fragment.insert(Math.floor(random() * (fragment.length + 1)), [newBlock(random)])
      client.ops.blockInsert++
      return
    }
    if (roll < 0.11 && list.length > 3) {
      // Remove a block
      const index = Math.floor(random() * fragment.length)
      fragment.delete(index, 1)
      client.ops.blockDelete++
      return
    }
    const el = list[Math.floor(random() * list.length)]
    let text = textOf(el)
    if (!text) {
      text = new Y.XmlText()
      el.insert(0, [text])
    }
    const len = text.length
    if (roll < 0.7 || len < 4) {
      const word = WORDS[Math.floor(random() * WORDS.length)]
      text.insert(Math.floor(random() * (len + 1)), word)
      client.ops.insert++
    } else if (roll < 0.85) {
      const at = Math.floor(random() * (len - 1))
      text.delete(at, 1 + Math.floor(random() * Math.min(5, len - at - 1)))
      client.ops.delete++
    } else {
      const at = Math.floor(random() * (len - 1))
      const mark = random() < 0.5 ? 'bold' : 'italic'
      text.format(at, 1 + Math.floor(random() * Math.min(8, len - at - 1)), { [mark]: random() < 0.8 ? {} : null })
      client.ops.format++
    }
  })
  recordSend(client)
}

function connect(index: number): Promise<Client> {
  const ydoc = new Y.Doc()
  return new Promise((resolve, reject) => {
    const client: Client = {
      index,
      ydoc,
      random: rng(SEED + index * 7919),
      ops: { insert: 0, delete: 0, format: 0, blockInsert: 0, blockDelete: 0 },
      provider: null as any,
    }
    const timer = setTimeout(() => reject(new Error(`client ${index} did not sync`)), 10_000)
    client.provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: `activity:${ACTIVITY}`,
      document: ydoc,
      token: TOKEN,
      onSynced: () => {
        clearTimeout(timer)
        resolve(client)
      },
      onAuthenticationFailed: ({ reason }) => reject(new Error(`client ${index}: ${reason}`)),
    })
    ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === client.provider) onRemoteUpdate(ydoc)
    })
  })
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function waitFor(check: () => boolean, timeoutMs: number) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 50))
  }
  return true
}

async function persisted(): Promise<{ content: PMNode; current_version: number }> {
  const response = await fetch(`${API_URL}/api/v1/activities/${ACTIVITY}/collab/state`, {
    headers: { 'X-Internal-Key': INTERNAL_KEY },
  })
  if (!response.ok) throw new Error(`state fetch ${response.status}`)
  return (await response.json()) as { content: PMNode; current_version: number }
}

async function main() {
  const before = await persisted()
  console.log(`[soak] ${CLIENTS} clients, ${SECONDS}s, ~${Math.round(1000 / EDIT_INTERVAL_MS)} edits/s each, activity ${ACTIVITY} (v${before.current_version})`)
  const clients = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => connect(i)))
  console.log('[soak] all clients synced')

  const end = Date.now() + SECONDS * 1000
  await Promise.all(
    clients.map(async (client) => {
      while (Date.now() < end) {
        randomEdit(client)
        // Exponential-ish spread around the mean interval
        await new Promise((r) => setTimeout(r, EDIT_INTERVAL_MS * (0.25 + client.random() * 1.5)))
      }
    }),
  )
  const totalOps = clients.reduce((n, c) => n + Object.values(c.ops).reduce((a, b) => a + b, 0), 0)
  console.log(`[soak] edits done: ${totalOps} ops`)

  // Convergence: identical state vectors and identical JSON on every client
  const converged = await waitFor(() => {
    const first = Y.encodeStateVector(clients[0].ydoc)
    return clients.every((c) => Buffer.compare(Buffer.from(Y.encodeStateVector(c.ydoc)), Buffer.from(first)) === 0)
  }, 15_000)
  const jsons = clients.map((c) => JSON.stringify(canonicalize(yDocToProsemirrorJSON(c.ydoc))))
  const identical = jsons.every((j) => j === jsons[0])

  // Disconnect everyone: the last disconnect saves the room
  for (const c of clients) c.provider.destroy()
  let saved = false
  let after = before
  for (let i = 0; i < 60 && !saved; i++) {
    await new Promise((r) => setTimeout(r, 500))
    after = await persisted()
    saved = JSON.stringify(canonicalize(after.content)) === jsons[0]
  }

  const sorted = [...latencies].sort((a, b) => a - b)
  const ops = clients.reduce(
    (acc, c) => {
      for (const [k, v] of Object.entries(c.ops)) acc[k] = (acc[k] ?? 0) + v
      return acc
    },
    {} as Record<string, number>,
  )
  const report = {
    clients: CLIENTS,
    seconds: SECONDS,
    ops,
    totalOps,
    samples: sorted.length,
    latencyMs: {
      p50: +percentile(sorted, 50).toFixed(1),
      p95: +percentile(sorted, 95).toFixed(1),
      p99: +percentile(sorted, 99).toFixed(1),
      max: +(sorted.at(-1) ?? NaN).toFixed(1),
    },
    converged,
    clientsIdentical: identical,
    persistedMatches: saved,
    versions: { before: before.current_version, after: after.current_version },
    blocks: (JSON.parse(jsons[0]).content ?? []).length,
    docBytes: Y.encodeStateAsUpdate(clients[0].ydoc).byteLength,
  }
  console.log(JSON.stringify(report, null, 2))
  if (process.env.SOAK_REPORT) fs.writeFileSync(process.env.SOAK_REPORT, JSON.stringify(report, null, 2))
  process.exit(converged && identical && saved ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
