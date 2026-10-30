import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Isolated file: mock docker.js so EE setup's Docker-readiness preflight
// (ensureDockerReady / ensurePortsFree) can be driven through every failure
// branch without a real daemon. Each case exits at preflight, before any files.
const dk = vi.hoisted(() => ({
  installed: true, composeWorks: true, running: true, runningThrows: false,
  installThrows: false, busyPorts: [] as number[],
  loginThrows: false, upThrows: false, upInvokesRetry: false, installFixes: false,
}))
const CANCEL = Symbol.for('clack:cancel')
const pq = vi.hoisted(() => ({ confirm: [] as unknown[], select: [] as unknown[], text: [] as unknown[], password: [] as unknown[] }))
import { expectMode } from './platform.js'
vi.mock('../src/services/docker.js', () => ({
  isDockerInstalled: () => dk.installed,
  dockerComposeWorks: () => dk.composeWorks,
  isDockerRunning: () => { if (dk.runningThrows) throw new Error('daemon probe blew up'); return dk.running },
  installDockerLinux: () => { if (dk.installThrows) throw new Error('apt failed'); if (dk.installFixes) { dk.installed = true; dk.composeWorks = true } },
  isTcpPortListening: (port: number) => dk.busyPorts.includes(port),
  dockerLogin: () => { if (dk.loginThrows) { const e = new Error('denied') as Error & { stderr?: string }; e.stderr = 'unauthorized'; throw e } },
  dockerComposePull: () => {},
  dockerLogout: () => {},
  dockerComposeUpRetry: (_dir: string, _n: number, onRetry: (n: number) => void) => {
    if (dk.upInvokesRetry) onRetry(1) // exercise the retry-notice callback
    if (dk.upThrows) { const e = new Error('boom') as Error & { stderr?: Buffer }; e.stderr = Buffer.from('compose failed'); throw e }
  },
}))
// Mock the slow post-start steps so the success path resolves immediately
// instead of polling the EE health endpoint with real timers.
vi.mock('../src/services/health.js', () => ({
  waitForEeReady: async () => 'ee',
  waitForHealth: async () => true,
  waitForOrgSeed: async () => true,
}))
vi.mock('../src/utils/network.js', () => ({
  getPublicIp: async () => '203.0.113.7',
}))
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: (v: unknown) => v === Symbol.for('clack:cancel'),
}))
vi.mock('@clack/prompts', () => ({
  ...promptStub,
  confirm: async () => (pq.confirm.length ? pq.confirm.shift() : Symbol.for('clack:cancel')),
  select: async () => (pq.select.length ? pq.select.shift() : Symbol.for('clack:cancel')),
  text: async (o: { validate?: (v: unknown) => string | undefined }) => {
    const v = pq.text.length ? pq.text.shift() : Symbol.for('clack:cancel')
    if (o?.validate && typeof v === 'string') o.validate(v); return v
  },
  password: async (o: { validate?: (v: unknown) => string | undefined }) => {
    const v = pq.password.length ? pq.password.shift() : Symbol.for('clack:cancel')
    if (o?.validate && typeof v === 'string') o.validate(v); return v
  },
}))

import { setupEnterprise } from '../src/commands/setup-ee.js'

const CI = {
  ci: true, name: 'ee-pre', license: 'lh_live_TESTKEY',
  domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
  adminPassword: 'password123', tenancy: 'single' as const, start: false,
}

describe('EE setup: Docker readiness preflight (CI)', () => {
  let origPlatform: PropertyDescriptor | undefined
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    dk.installed = true; dk.composeWorks = true; dk.running = true
    dk.runningThrows = false; dk.installThrows = false; dk.busyPorts = []
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
    vi.restoreAllMocks()
  })

  it('aborts when the daemon-running probe throws', async () => {
    dk.runningThrows = true
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })

  it('aborts when Docker is installed but the daemon is not running', async () => {
    dk.running = false
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })

  it('aborts when the compose plugin is missing', async () => {
    dk.composeWorks = false
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })

  it('aborts on a non-Linux host when Docker is absent', async () => {
    dk.installed = false
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })

  it('auto-installs on Linux and aborts if Docker still does not work afterwards', async () => {
    dk.installed = false // stays false after install → "still not working"
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })

  it('aborts when the Linux Docker install itself fails', async () => {
    dk.installed = false; dk.installThrows = true
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(setupEnterprise(CI)).rejects.toThrow(/exit 1/)
  })
})

describe('EE setup: start, DNS and file variants (CI)', () => {
  let home: string
  let origHome: string | undefined
  beforeEach(async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
    dk.installed = true; dk.composeWorks = true; dk.running = true
    dk.runningThrows = false; dk.installThrows = false; dk.busyPorts = []
    dk.loginThrows = false; dk.upThrows = false; dk.upInvokesRetry = false
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-eeci-'))
    origHome = process.env.HOME
    process.env.HOME = home
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(async () => {
    const fs = await import('node:fs')
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('rejects an invalid --domain', async () => {
    await expect(setupEnterprise({ ...CI, domain: 'not a domain!!' })).rejects.toThrow(/exit 1/) // 296
  })
  it('rejects an invalid --admin-email', async () => {
    await expect(setupEnterprise({ ...CI, adminEmail: 'nope' })).rejects.toThrow(/exit 1/) // 299
  })
  it('rejects an invalid --acme-email', async () => {
    await expect(setupEnterprise({ ...CI, acmeEmail: 'bad-acme' })).rejects.toThrow(/exit 1/) // 303
  })
  it('rejects a too-short --admin-password', async () => {
    await expect(setupEnterprise({ ...CI, adminPassword: 'x' })).rejects.toThrow(/exit 1/) // 306
  })
  it('rejects a --dns-provider other than cloudflare', async () => {
    await expect(setupEnterprise({ ...CI, dnsProvider: 'route53' as never })).rejects.toThrow(/exit 1/) // 308
  })

  it('writes a local-TLS override and prints the self-signed TLS notice', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    await setupEnterprise({ ...CI, name: 'ee-tls', localTls: true, start: true }) // start → dnsBlock TLS note (170-171)
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-tls', 'docker-compose.override.yml'))).toBe(true)
  })

  it('prints the wildcard DNS records for an agency install', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    // Agency needs a wildcard certificate: DNS-01 via Cloudflare (or --local-tls).
    await setupEnterprise({ ...CI, name: 'ee-agency', tenancy: 'agency', dnsProvider: 'cloudflare', cfApiToken: 'cf-token', start: true })
    const dir = path.join(home, '.learnhouse', 'ee-agency')
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'caddy.Dockerfile'))).toBe(true)
    const out = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('*.learn.school.dev')
  })

  it('refuses an agency install without --dns-provider or --local-tls', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    await expect(setupEnterprise({ ...CI, name: 'ee-agency-nodns', tenancy: 'agency', start: false })).rejects.toThrow(/exit 1/)
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/--dns-provider/)
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-agency-nodns', '.env'))).toBe(false)
  })

  it('aborts the start when 80/443 are already in use', async () => {
    dk.busyPorts = [80, 443]
    await expect(setupEnterprise({ ...CI, name: 'ee-ports', start: true })).rejects.toThrow(/exit 1/)
  })

  it('aborts the start when the registry login fails', async () => {
    dk.loginThrows = true
    await expect(setupEnterprise({ ...CI, name: 'ee-login', start: true })).rejects.toThrow(/exit 1/)
  })

  it('aborts the start when the compose stack fails to come up', async () => {
    dk.upThrows = true
    await expect(setupEnterprise({ ...CI, name: 'ee-up', start: true })).rejects.toThrow(/exit 1/)
  })

  it('surfaces the retry notice and completes when the stack starts', async () => {
    dk.upInvokesRetry = true // exercises the retry-notice callback, then succeeds
    await setupEnterprise({ ...CI, name: 'ee-retry', start: true })
    const fs = await import('node:fs'); const path = await import('node:path')
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-retry', '.env'))).toBe(true)
  })

  it('reuses the existing deployment id and secrets on redeploy', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    const dir = path.join(home, '.learnhouse', 'ee-redeploy')
    const read = () => ({
      id: JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8')).deploymentId,
      db: fs.readFileSync(path.join(dir, '.env'), 'utf-8').match(/^DB_PASSWORD=(.*)$/m)?.[1],
    })
    // First deploy creates the install; second (no-start) redeploys it.
    await setupEnterprise({ ...CI, name: 'ee-redeploy', start: false })
    const first = read()
    await setupEnterprise({ ...CI, name: 'ee-redeploy', start: false })
    expect(first.db).toBeTruthy()
    expect(read()).toEqual(first)
  })

  it('keeps the pinned image tag, external DB and DNS provider on a redeploy without those flags', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    const dir = path.join(home, '.learnhouse', 'ee-keep')
    await setupEnterprise({
      ...CI, name: 'ee-keep', start: false, eeImageTag: '1.5.3',
      externalDb: 'postgresql://u:p@db.school.dev:5432/lh', dnsProvider: 'cloudflare', cfApiToken: 'cf-token',
    })
    await setupEnterprise({ ...CI, name: 'ee-keep', start: false })
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf-8')
    expect(env).toMatch(/^EE_IMAGE_TAG='?1\.5\.3'?$/m)
    expect(env).toContain('postgresql://u:p@db.school.dev:5432/lh')
    expect(env).toContain('cf-token')
    const compose = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')
    expect(compose).not.toMatch(/^  db:\s*$/m)
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.useExternalDb).toBe(true)
    expect(cfg.dnsProvider).toBe('cloudflare')
    expect(fs.existsSync(path.join(dir, 'pgvector-init.sql'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'caddy.Dockerfile'))).toBe(true)
    expectMode(path.join(dir, '.env'), 0o600)
  })

  it('removes a stale local-TLS override when redeploying onto real certificates', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    const dir = path.join(home, '.learnhouse', 'ee-stale')
    await setupEnterprise({ ...CI, name: 'ee-stale', localTls: true, start: false })
    expect(fs.existsSync(path.join(dir, 'docker-compose.override.yml'))).toBe(true)
    await setupEnterprise({ ...CI, name: 'ee-stale', start: false })
    expect(fs.existsSync(path.join(dir, 'docker-compose.override.yml'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'Caddyfile'), 'utf-8')).not.toContain('local_certs')
  })

  it('refuses to overwrite a Community install in the target directory', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    const dir = path.join(home, '.learnhouse', 'ce-here')
    fs.mkdirSync(dir, { recursive: true })
    const ceConfig = JSON.stringify({ version: '1.5.0', deploymentId: 'abc123', edition: 'community', installDir: dir })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), ceConfig)
    fs.writeFileSync(path.join(dir, '.env'), 'POSTGRES_PASSWORD=keepme\n')
    await expect(setupEnterprise({ ...CI, name: 'ce-here', start: false })).rejects.toThrow(/exit 1/)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toBe('POSTGRES_PASSWORD=keepme\n')
  })
})

describe('EE setup: interactive Docker preflight', () => {
  let origPlatform: PropertyDescriptor | undefined
  beforeEach(() => {
    dk.installed = true; dk.composeWorks = true; dk.running = true
    dk.runningThrows = false; dk.installThrows = false; dk.busyPorts = []
    dk.loginThrows = false; dk.upThrows = false; dk.upInvokesRetry = false; dk.installFixes = false
    pq.confirm = []; pq.select = []; pq.text = []; pq.password = []
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
    vi.restoreAllMocks()
  })

  it('offers to install Docker and aborts if the prompt is declined', async () => {
    dk.installed = false
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    pq.confirm.push(false) // decline the "install Docker now?" prompt → die (86-87)
    await expect(setupEnterprise({ name: 'ee-iconf' })).rejects.toThrow(/exit/)
  })

  it('installs Docker, re-checks the daemon, then proceeds into the wizard', async () => {
    dk.installed = false; dk.installFixes = true // install makes Docker available → post-install checkRunning (95)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    pq.confirm.push(true)  // accept the install
    // first wizard prompt (tenancy select) is left empty → cancel → exit helper (359)
    await expect(setupEnterprise({ name: 'ee-iinstall' })).rejects.toThrow(/exit 0/)
  })
})
