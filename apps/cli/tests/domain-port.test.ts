import { describe, it, expect, beforeEach, vi } from 'vitest'

// Isolated file: mock the network probes so promptDomain's "canonical port is
// in use" branches (suggest-alternative / no-free-port) run deterministically,
// independent of which ports happen to be free on the test machine.
const net = vi.hoisted(() => ({ available: 80 as number | null, portFree: true, checkQueue: [] as boolean[] }))
vi.mock('../src/utils/network.js', () => ({
  findAvailablePort: async () => net.available,
  checkPort: async () => (net.checkQueue.length ? net.checkQueue.shift()! : net.portFree),
  parsePostgresUrl: () => null,
  parseRedisUrl: () => null,
  getPublicIp: async () => null,
  checkTcpConnection: async () => false,
}))

// Programmable prompt stub (text/select queues), modelled on the main harness.
const H = vi.hoisted(() => {
  const q = { text: [] as unknown[], select: [] as unknown[] }
  const next = (arr: unknown[]) => (arr.length ? arr.shift() : Symbol.for('clack:cancel'))
  return {
    q,
    reset() { q.text = []; q.select = [] },
    stub: {
      text: async (o: { validate?: (v: unknown) => string | undefined }) => {
        const v = next(q.text); if (o.validate && typeof v === 'string') o.validate(v); return v
      },
      select: async () => next(q.select),
      isCancel: (v: unknown) => v === Symbol.for('clack:cancel'),
      cancel: () => {}, log: { warn: () => {}, info: () => {}, error: () => {}, message: () => {}, step: () => {} },
    },
  }
})
vi.mock('../src/utils/prompt.js', () => H.stub)

import { promptDomain } from '../src/prompts/domain.js'

describe('promptDomain — canonical-port availability branches', () => {
  beforeEach(() => { H.reset(); net.checkQueue = [] })

  it('suggests an alternative when the canonical HTTP port is already in use', async () => {
    net.available = 8080 // findAvailablePort returns a different port → suggest it
    net.portFree = true
    H.q.text.push('localhost', '8080') // domain, then accept the suggested port
    const cfg = await promptDomain()
    expect(cfg).toMatchObject({ domain: 'localhost', useHttps: false, autoSsl: false, httpPort: 8080 })
  })

  it('warns when no free common port can be found', async () => {
    net.available = null // findAvailablePort gives up → "enter one manually" warning
    net.portFree = true
    H.q.text.push('localhost', '8081')
    const cfg = await promptDomain()
    expect(cfg.httpPort).toBe(8081)
  })

  it('re-prompts when the chosen (non-privileged) port is already taken', async () => {
    net.available = 80
    net.checkQueue = [false, true] // first chosen port busy → warn + retry, second free
    H.q.text.push('localhost', '9090', '9091') // domain, busy port, then a free one
    const cfg = await promptDomain()
    expect(cfg.httpPort).toBe(9091)
  })
})
