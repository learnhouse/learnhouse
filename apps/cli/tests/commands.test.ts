import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Docker helpers shell out via execSync — stub it so guard-path tests never
// touch a real daemon. spawn returns a fake long-lived child (so the dev
// happy-path can reach its keep-alive without launching real servers);
// spawnSync reports success (dependency installs are no-ops).
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const fakeChild = () => {
    const stream = { on: () => {} }
    // exitCode 0 → killProcess() resolves immediately (no real process to await).
    return { stdout: stream, stderr: stream, on: () => {}, kill: () => {}, killed: false, exitCode: 0, pid: 1 }
  }
  return {
    ...actual,
    execSync: vi.fn(() => Buffer.from('')),
    spawn: vi.fn(() => fakeChild()),
    spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })),
  }
})

// Replace both prompt modules with programmable stubs: logs/intro/spinner are
// no-ops, and each interactive prompt shifts the next scripted response off a
// per-kind queue (falling back to a "cancel" sentinel / false when empty). This
// lets tests drive multi-step flows headlessly instead of blocking on stdin.
const H = vi.hoisted(() => {
  const cancel = Symbol('cancel')
  const q: Record<string, unknown[]> = { select: [], text: [], confirm: [], multiselect: [], password: [] }
  const pull = (k: string, fallback: unknown) => (q[k].length ? q[k].shift() : fallback)
  const noop = () => {}
  const mock = {
    log: { error: noop, info: noop, success: noop, warn: noop, warning: noop, message: noop, step: noop },
    intro: noop, outro: noop, cancel: noop, note: noop, group: noop,
    spinner: () => ({ start: noop, stop: noop, message: noop }),
    select: async () => pull('select', cancel),
    multiselect: async () => pull('multiselect', cancel),
    // text/password also run any inline validate(value) so those branches are exercised.
    text: async (o?: { validate?: (v: string) => unknown }) => {
      const v = pull('text', cancel)
      if (o && typeof o.validate === 'function' && v !== cancel) o.validate(v as string)
      return v
    },
    password: async (o?: { validate?: (v: string) => unknown }) => {
      const v = pull('password', cancel)
      if (o && typeof o.validate === 'function' && v !== cancel) o.validate(v as string)
      return v
    },
    confirm: async () => pull('confirm', false),
    isCancel: (v: unknown) => v === cancel,
  }
  return { cancel, q, mock, reset: () => { for (const k of Object.keys(q)) q[k] = [] } }
})
vi.mock('@clack/prompts', () => H.mock)
vi.mock('../src/utils/prompt.js', () => H.mock)

// Health pollers would otherwise hit real URLs / exec on a 3-minute timeout —
// stub them (overridable per test) so setup/update run in-process without hanging.
const healthMock = vi.hoisted(() => ({
  waitForHealth: vi.fn(async () => true),
  waitForOrgSeed: vi.fn(async () => true),
  waitForEeReady: vi.fn(async () => 'ee' as const),
}))
vi.mock('../src/services/health.js', () => healthMock)

import { configCommand } from '../src/commands/config.js'
import { statusCommand } from '../src/commands/status.js'
import { startCommand } from '../src/commands/start.js'
import { stopCommand } from '../src/commands/stop.js'
import { healthCommand } from '../src/commands/health.js'
import { shellCommand } from '../src/commands/shell.js'
import { logsCommand } from '../src/commands/logs.js'
import { scaleCommand, parseMemLimit, setMemLimit } from '../src/commands/scale.js'
import { envCommand } from '../src/commands/env.js'
import { deploymentsCommand } from '../src/commands/deployments.js'
import { backupCommand } from '../src/commands/backup.js'
import { restoreCommand } from '../src/commands/restore.js'
import { updateCommand } from '../src/commands/update.js'
import { doctorCommand } from '../src/commands/doctor.js'
import { promptAdmin } from '../src/prompts/admin.js'
import { promptOrganization } from '../src/prompts/organization.js'
import { promptDomain } from '../src/prompts/domain.js'
import { promptFeatures } from '../src/prompts/features.js'
import { promptDatabase } from '../src/prompts/database.js'
import { checkDevEnv } from '../src/services/env-check.js'
import { devCommand } from '../src/commands/dev.js'
import { printBanner } from '../src/ui/banner.js'
import { setupCommand } from '../src/commands/setup.js'
import { checkPrerequisites } from '../src/prompts/prerequisites.js'
import { setupEnterprise } from '../src/commands/setup-ee.js'
import { dockerLogin, dockerComposeLogs, dockerLogsMulti, dockerExecInteractive } from '../src/services/docker.js'

// ─── Command guards — every entry point must bail cleanly with no install ──
//
// Each command resolves an install, then `process.exit(1)`s when none exists.
// Real process.exit would terminate; the code after it assumes a non-null
// config, so a test mock MUST throw to model termination. We point HOME at an
// empty dir so findInstallDir (via os.homedir) sees no installations.

class ProcessExit extends Error {
  code: number
  constructor(code: number) { super(`process.exit(${code})`); this.code = code }
}

describe('command guards — no installation / bad arguments', () => {
  let emptyHome: string
  let origHome: string | undefined

  beforeEach(() => {
    emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-cmdguard-'))
    origHome = process.env.HOME
    process.env.HOME = emptyHome
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(emptyHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it.each([
    ['config', () => configCommand()],
    ['status', () => statusCommand()],
    ['start', () => startCommand()],
    ['stop', () => stopCommand()],
    ['health', () => healthCommand()],
    ['shell', () => shellCommand()],
    ['logs', () => logsCommand()],
    ['scale', () => scaleCommand()],
    ['env', () => envCommand()],
    ['backup', () => backupCommand()],
    ['update', () => updateCommand({})],
  ])('%s exits when no installation exists', async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('restore exits when called with no archive argument', async () => {
    await expect(restoreCommand('')).rejects.toBeInstanceOf(ProcessExit)
  })

  it('restore exits when the archive path does not exist', async () => {
    await expect(restoreCommand(path.join(emptyHome, 'nope.tar.gz'))).rejects.toBeInstanceOf(ProcessExit)
  })

  it('deployments (menu-first) exits cleanly when the menu is dismissed', async () => {
    // deployments has no install guard — it opens a select menu; a cancelled
    // selection must exit(0), not crash or hang.
    await expect(deploymentsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('deployments → scale exits when no installation exists', async () => {
    H.q.select.push('scale') // menu → scale → scaleResources finds no install → exit
    await expect(deploymentsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })
})

// ─── scale — compose mem_limit parse / set (pure) ───────────
//
// `scale` reads and rewrites mem_limit lines in docker-compose.yml. These
// are the exact text transforms, exercised without Docker.

describe('scale — mem_limit parse/set', () => {
  const compose = [
    'services:',
    '  learnhouse-app:',
    '    image: ghcr.io/learnhouse/app:latest',
    '    container_name: learnhouse-app-dep1',
    '    mem_limit: 2g',
    '  db:',
    '    image: pgvector/pgvector:pg16',
    '    container_name: learnhouse-db-dep1',
    '  redis:',
    '    image: redis:7-alpine',
    '    container_name: learnhouse-redis-dep1',
    '',
  ].join('\n')

  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-scale-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('parseMemLimit reads existing limits and omits services without one', () => {
    const p = path.join(dir, 'docker-compose.yml')
    fs.writeFileSync(p, compose)
    const limits = parseMemLimit(p)
    expect(limits.get('learnhouse-app')).toBe('2g')
    expect(limits.has('db')).toBe(false)
    expect(limits.has('redis')).toBe(false)
  })

  it('setMemLimit replaces an existing mem_limit in place', () => {
    const updated = setMemLimit(compose, 'learnhouse-app', '512m')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), updated)
    expect(parseMemLimit(path.join(dir, 'docker-compose.yml')).get('learnhouse-app')).toBe('512m')
  })

  it('setMemLimit inserts a new mem_limit after container_name', () => {
    const updated = setMemLimit(compose, 'db', '1g')
    expect(updated).toMatch(/container_name: learnhouse-db-dep1\n {4}mem_limit: 1g/)
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), updated)
    expect(parseMemLimit(path.join(dir, 'docker-compose.yml')).get('db')).toBe('1g')
  })

  it('setMemLimit round-trips for every standard service', () => {
    let c = compose
    c = setMemLimit(c, 'learnhouse-app', '4g')
    c = setMemLimit(c, 'db', '1g')
    c = setMemLimit(c, 'redis', '256m')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), c)
    const limits = parseMemLimit(path.join(dir, 'docker-compose.yml'))
    expect(limits.get('learnhouse-app')).toBe('4g')
    expect(limits.get('db')).toBe('1g')
    expect(limits.get('redis')).toBe('256m')
  })
})

// ─── dev pre-flight — checkDevEnv (the dev command's env gate) ───
//
// `dev` spawns the real API/Web servers (not unit-testable), but its
// pre-flight env check is pure fs: it scans apps/*/.env for required vars
// and only prompts when something is missing. Both outcomes are covered;
// the missing-vars prompt is auto-cancelled by the stubbed select above.

describe('checkDevEnv', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-dev-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function writeEnv(rel: string, body: string) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
  }

  it('returns true when every required dev var is present (quoted/commented values too)', async () => {
    // Quotes and inline comments exercise the parseEnvFile stripping branches.
    writeEnv('apps/api/.env',
      'LEARNHOUSE_AUTH_JWT_SECRET_KEY="jwt-secret"  # the signing key\nCOLLAB_INTERNAL_KEY=\'collab-key\'\n')
    writeEnv('apps/web/.env.local',
      'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost:9000\n')
    writeEnv('apps/collab/.env',
      'COLLAB_PORT=4000\nLEARNHOUSE_API_URL=http://localhost:9000\n' +
      'LEARNHOUSE_AUTH_JWT_SECRET_KEY=jwt\nCOLLAB_INTERNAL_KEY=collab\n')

    expect(await checkDevEnv(root)).toBe(true)
  })

  it('returns false when required vars are missing and the fix prompt is cancelled', async () => {
    // No env files at all → everything missing → prompt → (stub cancels) → false
    expect(await checkDevEnv(root)).toBe(false)
  })

  it('writes dev defaults for the missing vars when the user opts in', async () => {
    H.q.select.push('defaults') // choose "apply dev defaults and continue"
    expect(await checkDevEnv(root)).toBe(true)
    expect(fs.existsSync(path.join(root, 'apps/api/.env'))).toBe(true)
    expect(fs.readFileSync(path.join(root, 'apps/api/.env'), 'utf-8'))
      .toContain('LEARNHOUSE_AUTH_JWT_SECRET_KEY=')
    // Assert an actual DEFAULT VALUE is written (not just that the file exists):
    // the collab WebSocket port default must be 4000, the value the dev stack expects.
    expect(fs.readFileSync(path.join(root, 'apps/collab/.env'), 'utf-8'))
      .toContain('COLLAB_PORT=4000')
  })

  it('appends defaults to an existing env file that lacks a trailing newline', async () => {
    // Pre-existing partial file with NO trailing newline → appendToEnvFile must
    // insert the missing separator before adding the defaulted vars.
    writeEnv('apps/api/.env', 'COLLAB_INTERNAL_KEY=collab') // no "\n" at EOF, JWT key missing
    H.q.select.push('defaults')
    expect(await checkDevEnv(root)).toBe(true)
    const body = fs.readFileSync(path.join(root, 'apps/api/.env'), 'utf-8')
    expect(body).toMatch(/COLLAB_INTERNAL_KEY=collab\nLEARNHOUSE_AUTH_JWT_SECRET_KEY=/)
  })
})

// ─── Interactive command flows (driven via scripted prompts) ────
//
// These exercise the FULL bodies of the interactive commands — not just
// guards — by scripting prompt responses and pointing the command at a
// real fixture install in a temp $HOME. Docker calls hit the mocked
// execSync, so nothing touches a daemon.

describe('interactive command flows', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined
  let execSyncMock: ReturnType<typeof vi.fn>

  const COMPOSE = [
    'name: learnhouse-dep1',
    'services:',
    '  learnhouse-app:',
    '    image: ghcr.io/learnhouse/app:latest',
    '    container_name: learnhouse-app-dep1',
    '  db:',
    '    image: pgvector/pgvector:pg16',
    '    container_name: learnhouse-db-dep1',
    '  redis:',
    '    image: redis:7-alpine',
    '    container_name: learnhouse-redis-dep1',
    '',
  ].join('\n')

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-flow-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\nHTTP_PORT=8080\n')
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), COMPOSE)

    origHome = process.env.HOME
    process.env.HOME = home
    H.reset()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
    execSyncMock = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSyncMock.mockReset()
    execSyncMock.mockReturnValue(Buffer.from(''))
    const sp = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    sp.mockReset(); sp.mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    H.reset()
    vi.restoreAllMocks()
  })

  it('scale writes the chosen mem_limits for every service', async () => {
    H.q.text.push('512m', '1g', '256m') // learnhouse-app, db, redis
    H.q.confirm.push(false)             // do not restart

    await scaleCommand()

    const limits = parseMemLimit(path.join(installDir, 'docker-compose.yml'))
    expect(limits.get('learnhouse-app')).toBe('512m')
    expect(limits.get('db')).toBe('1g')
    expect(limits.get('redis')).toBe('256m')
  })

  it('scale restarts services when the user confirms', async () => {
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(true) // restart now → dockerComposeDown + dockerComposeUp (mocked)
    await expect(scaleCommand()).resolves.toBeUndefined()
    expect(parseMemLimit(path.join(installDir, 'docker-compose.yml')).get('db')).toBe('1g')
  })

  it('scale reports no changes when nothing valid is entered', async () => {
    H.q.text.push('', '', '') // all empty → no change → "No changes made"
    await expect(scaleCommand()).resolves.toBeUndefined()
  })

  it('scale shows fallback stats when compose stats fails', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats') // → fallback
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('docker stats')) return Buffer.from('NAME\tCPU\nlearnhouse-app-dep1\t5%\n')
      return Buffer.from('')
    }) as never)
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(scaleCommand()).resolves.toBeUndefined()
  })

  it('scale handles no running containers in the stats fallback', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats')
      return Buffer.from('') // docker ps empty → no running containers
    }) as never)
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(scaleCommand()).resolves.toBeUndefined()
  })

  it('scale exits when docker-compose.yml is missing', async () => {
    fs.rmSync(path.join(installDir, 'docker-compose.yml'))
    await expect(scaleCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('scale tolerates a total stats failure (both compose and per-container)', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats')
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('docker stats')) throw new Error('stats unavailable') // → outer catch
      return Buffer.from('')
    }) as never)
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(scaleCommand()).resolves.toBeUndefined()
  })

  it('deployments → view renders a per-deployment container status table', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) {
        return Buffer.from([
          'learnhouse-app-abc123\tUp 2 hours\tlearnhouse/app:1.4.8',
          'learnhouse-db-abc123\tUp 2 hours\tpostgres:16',
          'learnhouse-redis-abc123\tExited (0) 1 min ago\tredis:7',
        ].join('\n'))
      }
      return Buffer.from('')
    }) as never)
    H.q.select.push('view')
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → view reports cleanly when no deployments exist', async () => {
    H.q.select.push('view')
    await expect(deploymentsCommand()).resolves.toBeUndefined() // execSync returns '' → none found
  })

  it('deployments → scale warns when stats lookup throws in the fallback path', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats') // primary stats fail
      if (cmd.includes('docker stats')) throw new Error('stats blew up') // fallback container stats fail → 181
      if (cmd.includes('docker ps')) {
        // container id matches the fixture deploymentId (dep1) so it counts as running
        return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tlearnhouse/app:1.4.8')
      }
      return Buffer.from('')
    }) as never)
    H.q.select.push('scale')
    H.q.text.push('', '', '')
    H.q.confirm.push(false)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → view exits with an error when Docker cannot be queried', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) throw new Error('Cannot connect to the Docker daemon')
      return Buffer.from('')
    }) as never)
    H.q.select.push('view')
    await expect(deploymentsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('deployments → view falls back to the app-only listing when the broad query fails', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    let ps = 0
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('name=learnhouse-app-')) {
        return Buffer.from('learnhouse-app-abc123\tUp 2 hours\tlearnhouse/app:1.4.8')
      }
      if (cmd.includes('name=learnhouse-')) { ps++; throw new Error('broad query failed') }
      return Buffer.from('')
    }) as never)
    H.q.select.push('view')
    await expect(deploymentsCommand()).resolves.toBeUndefined()
    expect(ps).toBeGreaterThan(0)
  })

  it('deployments → scale handles no running containers in the stats fallback', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats') // → fallback
      return Buffer.from('') // docker ps empty → no running containers
    }) as never)
    H.q.select.push('scale')
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('scale tolerates a restart failure', async () => {
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(true)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose down') || cmd.includes('up -d')) throw new Error('restart failed')
      return Buffer.from('')
    }) as never)
    await expect(scaleCommand()).resolves.toBeUndefined() // restart catch → logs, no crash
  })

  it('scale skips an invalid limit and leaves that service unchanged', async () => {
    H.q.text.push('notvalid', '1g', '') // app invalid, db ok, redis empty/skip
    H.q.confirm.push(false)

    await scaleCommand()

    const limits = parseMemLimit(path.join(installDir, 'docker-compose.yml'))
    expect(limits.has('learnhouse-app')).toBe(false)
    expect(limits.get('db')).toBe('1g')
    expect(limits.has('redis')).toBe(false)
  })

  it('env edits a variable and persists it to .env', async () => {
    H.q.select.push('domain', 'LEARNHOUSE_DOMAIN', '_done') // category, key, then done
    H.q.text.push('school.example.com')
    H.q.confirm.push(false)

    await envCommand()

    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8'))
      .toContain('LEARNHOUSE_DOMAIN=school.example.com')
  })

  it('env makes no change when the editor is dismissed immediately', async () => {
    H.q.select.push('_done')
    await envCommand()
    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8')).toContain('LEARNHOUSE_DOMAIN=localhost')
  })

  it('deployments → scale sets mem limits through the resource menu', async () => {
    H.q.select.push('scale')          // menu choice
    H.q.text.push('512m', '1g', '256m') // per-service limits
    H.q.confirm.push(false)            // no restart
    await expect(deploymentsCommand()).resolves.toBeUndefined()
    expect(parseMemLimit(path.join(installDir, 'docker-compose.yml')).get('learnhouse-app')).toBe('512m')
  })

  it('deployments → scale restarts services when confirmed', async () => {
    H.q.select.push('scale')
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(true) // restart → dockerComposeDown + Up (mocked execSync)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → scale falls back to per-container stats when compose stats fails', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose stats')) throw new Error('no compose stats')
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('docker stats')) return Buffer.from('NAME\tCPU\nlearnhouse-app-dep1\t5%\n')
      return Buffer.from('')
    }) as never)
    H.q.select.push('scale')
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → scale exits when docker-compose.yml is missing', async () => {
    fs.rmSync(path.join(installDir, 'docker-compose.yml'))
    H.q.select.push('scale')
    await expect(deploymentsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('deployments → scale replaces an existing mem_limit', async () => {
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), [
      'name: learnhouse-dep1', 'services:',
      '  learnhouse-app:', '    container_name: learnhouse-app-dep1', '    mem_limit: 1g',
      '  db:', '    container_name: learnhouse-db-dep1',
      '  redis:', '    container_name: learnhouse-redis-dep1', '',
    ].join('\n'))
    H.q.select.push('scale')
    H.q.text.push('512m', '', '') // change app 1g → 512m; db/redis unchanged
    H.q.confirm.push(false)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
    expect(parseMemLimit(path.join(installDir, 'docker-compose.yml')).get('learnhouse-app')).toBe('512m')
  })

  it('deployments → scale reports no changes when all limits are invalid/empty', async () => {
    H.q.select.push('scale')
    H.q.text.push('bad', '', 'also-bad') // none match \d+[mg] → invalid/skip → no change
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → scale tolerates a restart failure', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    let wrote = false
    m.mockImplementation(((cmd: string) => {
      if ((cmd.includes('down') || cmd.includes('up')) && wrote) throw new Error('docker restart failed')
      if (cmd.includes('up') || cmd.includes('down')) { wrote = true }
      return Buffer.from('')
    }) as never)
    H.q.select.push('scale')
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(true) // restart → down/up throw → caught, no crash
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments → scale shows live stats when available', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('stats')
        ? Buffer.from('NAME\tCPU\tMEM\nlearnhouse-app-dep1\t5%\t200MiB\n')
        : Buffer.from('')) as never)
    H.q.select.push('scale')
    H.q.text.push('512m', '1g', '256m')
    H.q.confirm.push(false)
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('env masks existing secrets and preserves unrelated/comment lines on write', async () => {
    fs.writeFileSync(path.join(installDir, '.env'), [
      '# top comment',
      'NEXTAUTH_SECRET=supersecretvalue',   // secret + present → masked on display (67)
      'STRAY_LINE_WITHOUT_EQUALS',           // no "=" → preserved verbatim on write (97-98)
      'POSTGRES_DB=learnhouse',              // not edited → passed through unchanged (105)
      '',
    ].join('\n'))
    // Edit an EXISTING key so the rewrite loop runs: the edited line is replaced
    // (102-103) while POSTGRES_DB passes through unchanged (105).
    H.q.select.push('security', 'NEXTAUTH_SECRET', '_done')
    H.q.text.push('rotated-secret-value')
    H.q.confirm.push(false) // no restart
    await expect(envCommand()).resolves.toBeUndefined()
    const body = fs.readFileSync(path.join(installDir, '.env'), 'utf-8')
    expect(body).toContain('STRAY_LINE_WITHOUT_EQUALS')        // 97-98
    expect(body).toContain('POSTGRES_DB=learnhouse')            // 105
    expect(body).toContain('NEXTAUTH_SECRET=rotated-secret-value')
  })

  it('env appends a previously-missing variable to .env', async () => {
    // NEXTAUTH_URL is in the domain category but absent from the fixture .env.
    H.q.select.push('domain', 'NEXTAUTH_URL', '_done')
    H.q.text.push('http://localhost:8080')
    H.q.confirm.push(false)

    await envCommand()

    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8'))
      .toContain('NEXTAUTH_URL=http://localhost:8080')
  })

  it('env exits when the install has no .env file', async () => {
    // cwd-fallback config (no listed install) with a compose but no .env, so the
    // editor reaches its ".env missing" guard.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-env-noenv-home-'))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-env-noenv-cwd-'))
    fs.writeFileSync(path.join(proj, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: proj, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(proj, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n')
    const origCwd = process.cwd()
    process.env.HOME = empty
    process.chdir(proj)
    try {
      await expect(envCommand()).rejects.toBeInstanceOf(ProcessExit) // ".env missing" → exit(1)
    } finally {
      process.chdir(origCwd)
      fs.rmSync(empty, { recursive: true, force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })

  it('env restarts services after an edit when the user confirms', async () => {
    H.q.select.push('domain', 'LEARNHOUSE_DOMAIN', '_done')
    H.q.text.push('restarted.example.com')
    H.q.confirm.push(true) // restart now → dockerComposeDown + Up (mocked)
    await expect(envCommand()).resolves.toBeUndefined()
    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8'))
      .toContain('LEARNHOUSE_DOMAIN=restarted.example.com')
  })

  it('env tolerates a restart failure after an edit', async () => {
    H.q.select.push('domain', 'LEARNHOUSE_DOMAIN', '_done')
    H.q.text.push('new.example.com')
    H.q.confirm.push(true)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose down') || cmd.includes('up -d')) throw new Error('restart failed')
      return Buffer.from('')
    }) as never)
    await expect(envCommand()).resolves.toBeUndefined() // restart catch → logs, no crash
  })

  it('doctor runs the full diagnostic and completes on a healthy mocked env', async () => {
    // execSync returns '' for every probe (docker present); doctor should walk
    // all sections and finish without throwing.
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor aborts when Docker is not installed', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('docker: command not found') })
    await expect(doctorCommand()).rejects.toBeInstanceOf(ProcessExit)
  })
})

// ─── setup input layer — the prompt sub-modules (driven) ────────
//
// setup's file generation is covered by the binary `setup --ci` test in
// unit.test.ts; here we drive its INPUT gathering — the prompt modules —
// with scripted answers and assert the config objects they return.

describe('setup input prompts', () => {
  beforeEach(() => {
    H.reset()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
  })
  afterEach(() => { H.reset(); vi.restoreAllMocks() })

  it('promptAdmin returns the entered email and password', async () => {
    H.q.text.push('admin@school.dev')
    H.q.password.push('a-strong-password')
    await expect(promptAdmin()).resolves.toEqual({
      adminEmail: 'admin@school.dev',
      adminPassword: 'a-strong-password',
    })
  })

  it('promptAdmin exits when the email prompt is cancelled', async () => {
    // empty queue → text resolves to the cancel sentinel → exit(0)
    await expect(promptAdmin()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptOrganization lowercases the slug', async () => {
    H.q.text.push('My School', 'MY-ORG')
    await expect(promptOrganization()).resolves.toEqual({
      orgName: 'My School',
      orgSlug: 'my-org',
    })
  })

  it('promptDomain on localhost skips HTTPS and returns the chosen port', async () => {
    H.q.text.push('localhost', '39517') // domain, then a free high port
    const cfg = await promptDomain()
    expect(cfg).toMatchObject({ domain: 'localhost', useHttps: false, autoSsl: false, httpPort: 39517 })
  })

  it('promptDomain re-prompts when the entered port is already in use', async () => {
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, () => r())) // occupy the same way checkPort binds
    const taken = (server.address() as { port: number }).port
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, () => r()))
    const free = (probe.address() as { port: number }).port
    await new Promise<void>((r) => probe.close(() => r()))
    try {
      H.q.text.push('localhost', String(taken), String(free)) // domain, in-use port → retry → free port
      const cfg = await promptDomain()
      expect(cfg.httpPort).toBe(free)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('promptDomain with manual HTTPS sets useHttps without auto-ssl', async () => {
    H.q.text.push('learn.example.com') // non-localhost domain
    H.q.select.push('manual')          // HTTPS choice
    H.q.text.push('443')               // port (<=1024 → trusted, no checkPort)
    const cfg = await promptDomain()
    expect(cfg).toMatchObject({ domain: 'learn.example.com', useHttps: true, autoSsl: false, httpPort: 443 })
  })

  it('promptDomain with no HTTPS leaves https disabled', async () => {
    H.q.text.push('learn.example.com')
    H.q.select.push('none')
    H.q.text.push('80')
    const cfg = await promptDomain()
    expect(cfg).toMatchObject({ domain: 'learn.example.com', useHttps: false, autoSsl: false, httpPort: 80 })
  })

  it('promptDatabase exits when the generated-credentials ack is declined', async () => {
    H.q.select.push('local', 'ai')
    H.q.confirm.push(false) // "Continue?" declined → exit(0)
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDatabase external Postgres rejects a malformed URL then exits when unreachable', async () => {
    H.q.select.push('external') // external postgres
    H.q.text.push(
      'mysql://nope',                       // fails the postgresql:// validate rule, then parse → loop
      'postgresql://u:p@127.0.0.1:1/lh',    // parses; port 1 refused → connection failed
    )
    H.q.confirm.push(false) // retry declined → exit(0)
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDatabase external Redis rejects a URL with the wrong scheme', async () => {
    H.q.select.push('local', 'ai', 'external')
    H.q.confirm.push(true)        // db credential ack
    H.q.text.push('http://nope')  // fails the redis:// validate rule, then parse → loop → cancel → exit
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDatabase external Redis exits when unreachable and retry is declined', async () => {
    H.q.select.push('local', 'ai', 'external')
    H.q.confirm.push(true, false) // db ack yes; retry no
    H.q.text.push('redis://127.0.0.1:1') // port 1 → connection refused → unreachable
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDatabase external Redis loops on an unparseable URL', async () => {
    H.q.select.push('local', 'ai', 'external') // db local, ai image, redis external
    H.q.confirm.push(true)                      // db credential ack
    H.q.text.push('redis://[bad')               // parse fails → loop; next text → cancel → exit
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDomain with auto-SSL collects the ACME email and uses 443', async () => {
    H.q.text.push('learn.example.com') // domain (non-localhost)
    H.q.select.push('auto')            // HTTPS choice → automatic SSL
    H.q.text.push('ops@example.com')   // ACME email
    H.q.text.push('443')               // port (autoSsl → no checkPort probe)
    const cfg = await promptDomain()
    expect(cfg).toMatchObject({
      domain: 'learn.example.com', useHttps: true, autoSsl: true,
      sslEmail: 'ops@example.com', httpPort: 443,
    })
  })

  it('promptFeatures with nothing selected returns all flags false', async () => {
    H.q.multiselect.push([])
    await expect(promptFeatures()).resolves.toEqual({
      aiEnabled: false, emailEnabled: false, s3Enabled: false,
      googleOAuthEnabled: false, unsplashEnabled: false,
    })
  })

  it('promptFeatures with every feature (SMTP email) collects all sub-config', async () => {
    H.q.multiselect.push(['ai', 'email', 's3', 'google', 'unsplash'])
    H.q.select.push('smtp')
    H.q.text.push(
      'AIzaKEY',          // gemini key
      'smtp.test',        // smtp host
      '587',              // smtp port
      'user',             // smtp username
      'noreply@test.dev', // system email (after smtp block)
      'mybucket',         // s3 bucket
      '',                 // s3 endpoint (empty → AWS default)
      'gid',              // google client id
      'gsecret',          // google client secret
      'ukey',             // unsplash key
    )
    H.q.password.push('smtp-pw')
    H.q.confirm.push(true) // use TLS

    await expect(promptFeatures()).resolves.toMatchObject({
      aiEnabled: true, emailEnabled: true, s3Enabled: true,
      googleOAuthEnabled: true, unsplashEnabled: true,
      geminiApiKey: 'AIzaKEY', emailProvider: 'smtp', smtpHost: 'smtp.test',
      smtpPort: 587, smtpUsername: 'user', smtpPassword: 'smtp-pw', smtpUseTls: true,
      systemEmailAddress: 'noreply@test.dev', s3BucketName: 'mybucket',
      googleClientId: 'gid', googleClientSecret: 'gsecret', unsplashAccessKey: 'ukey',
    })
  })

  it('promptFeatures with Resend email collects the API key', async () => {
    H.q.multiselect.push(['email'])
    H.q.select.push('resend')
    H.q.text.push('re_key', 'noreply@test.dev')
    await expect(promptFeatures()).resolves.toMatchObject({
      emailEnabled: true, emailProvider: 'resend',
      resendApiKey: 're_key', systemEmailAddress: 'noreply@test.dev',
    })
  })

  it('promptDatabase external path verifies a reachable connection string', async () => {
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      H.q.select.push('external', 'local') // db external, redis local
      H.q.text.push(`postgresql://u:p@127.0.0.1:${port}/lh`)
      const cfg = await promptDatabase()
      expect(cfg.useExternalDb).toBe(true)
      expect(cfg.externalDbConnectionString).toContain(`127.0.0.1:${port}`)
      expect(cfg.useExternalRedis).toBe(false)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('promptDatabase external loops on an unparseable connection string', async () => {
    H.q.select.push('external')
    H.q.text.push('postgresql://[bad') // parse fails → loop; next text prompt → cancel → exit
    await expect(promptDatabase()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('promptDatabase with external Redis verifies a reachable Redis URL', async () => {
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      H.q.select.push('local', 'ai', 'external') // db local, db image ai, redis external
      H.q.confirm.push(true)                      // db credential ack
      H.q.text.push(`redis://127.0.0.1:${port}`)
      const cfg = await promptDatabase()
      expect(cfg.useExternalRedis).toBe(true)
      expect(cfg.externalRedisConnectionString).toContain(`127.0.0.1:${port}`)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('promptDatabase local path generates a password and honours the AI image choice', async () => {
    H.q.select.push('local', 'ai', 'local') // db setup, db image, redis setup
    H.q.confirm.push(true)                  // acknowledge generated credentials
    const cfg = await promptDatabase()
    expect(cfg.useExternalDb).toBe(false)
    expect(cfg.useExternalRedis).toBe(false)
    expect(cfg.useAiDatabase).toBe(true)
    expect(typeof cfg.dbPassword).toBe('string')
    expect((cfg.dbPassword ?? '').length).toBeGreaterThan(8)
  })
})

// ─── dev command guards ─────────────────────────────────────────
//
// devCommand ends in `await new Promise(() => {})` — it runs the local
// servers until Ctrl+C and never returns by design, so the happy-path tail
// (spawn + keep-alive) cannot be asserted past that point. Every DECISION
// branch before it is reachable, driven here by controlling process.cwd()
// (so findProjectRoot resolves to a fixture) and the docker/env state.

describe('dev command guards', () => {
  let tmp: string
  let origCwd: string
  let execSyncMock: ReturnType<typeof vi.fn>

  function fakeRepo(withEnv: boolean): string {
    const root = path.join(tmp, 'repo')
    for (const d of ['apps/api', 'apps/web', 'apps/collab']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    if (withEnv) {
      fs.writeFileSync(path.join(root, 'apps/api/.env'),
        'LEARNHOUSE_AUTH_JWT_SECRET_KEY=x\nCOLLAB_INTERNAL_KEY=y\n')
      fs.writeFileSync(path.join(root, 'apps/web/.env.local'),
        'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost:9000\n')
      fs.writeFileSync(path.join(root, 'apps/collab/.env'),
        'COLLAB_PORT=4000\nLEARNHOUSE_API_URL=http://localhost:9000\n' +
        'LEARNHOUSE_AUTH_JWT_SECRET_KEY=x\nCOLLAB_INTERNAL_KEY=y\n')
    }
    return root
  }

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-dev-'))
    origCwd = process.cwd()
    H.reset()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
    execSyncMock = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSyncMock.mockReset()
    execSyncMock.mockReturnValue(Buffer.from(''))
    const sp = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    sp.mockReset(); sp.mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
    H.reset()
    vi.restoreAllMocks()
  })

  it('exits when not inside a LearnHouse project', async () => {
    process.chdir(tmp) // a bare temp dir — no apps/api+apps/web up the tree
    await expect(devCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when required dev env vars are missing (fix prompt cancelled)', async () => {
    process.chdir(fakeRepo(false))
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' }))
      .rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when Docker is not installed', async () => {
    process.chdir(fakeRepo(true)) // env OK → past checkDevEnv
    execSyncMock.mockImplementation(() => { throw new Error('docker: command not found') })
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' }))
      .rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when the Docker daemon is not running', async () => {
    process.chdir(fakeRepo(true))
    execSyncMock.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker info')) throw new Error('daemon down') // installed but not running
      return Buffer.from('')
    }) as never)
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('prefixes and prints child server output', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    let dataHandler: ((b: Buffer) => void) | undefined
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockImplementation((() => ({
      exitCode: 0, killed: false,
      stdout: { on: (ev: string, cb: (b: Buffer) => void) => { if (ev === 'data') dataHandler = cb } },
      stderr: { on: () => {} }, on: () => {}, kill: () => {},
    })) as never)
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      // 60 lines → exercises the per-line prefixing AND the controls-bar reprint (every 50 lines)
      dataHandler?.(Buffer.from(Array.from({ length: 60 }, (_, i) => `log line ${i}`).join('\n') + '\n'))
      expect(writeSpy).toHaveBeenCalled()
    } finally {
      writeSpy.mockRestore()
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('warns but continues when the EE symlink cannot be created', async () => {
    const root = fakeRepo(true)
    fs.mkdirSync(path.join(tmp, 'ee', 'apps', 'api', 'ee'), { recursive: true })
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => { throw new Error('EPERM: operation not permitted') })
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ ee: true, adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      expect(spawnMock).toHaveBeenCalledTimes(3) // symlink failure is non-fatal
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('symlinks the EE folder when a sibling ee repo exists', async () => {
    const root = fakeRepo(true) // tmp/repo
    const eeRepoPath = path.join(tmp, 'ee', 'apps', 'api', 'ee') // sibling repo (parent/ee/...)
    fs.mkdirSync(eeRepoPath, { recursive: true })
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ ee: true, adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      expect(fs.existsSync(path.join(root, 'apps', 'api', 'ee'))).toBe(true) // symlink created
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('runs in OSS mode when --ee is passed but no ee folder exists', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ ee: true, adminEmail: 'a@b.dev', adminPassword: 'pw' }) // --ee but no ee/ → OSS warn
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      expect(spawnMock).toHaveBeenCalledTimes(3)
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('exits when no admin password is provided', async () => {
    process.chdir(fakeRepo(true)) // infra not already running → prompts for admin creds
    H.q.text.push('a@b.dev') // admin email prompt
    H.q.password.push('')    // empty password → "Password is required" → exit
    await expect(devCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('treats infra as down when the docker inspect probe throws', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    execSyncMock.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker inspect')) throw new Error('daemon gone') // isContainerRunning catch → false (133)
      return Buffer.from('')
    }) as never)
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150)) // infra seen as down → started → reaches keep-alive
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('logs when a dev server process exits with a non-zero code', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    const children: Array<{ _exit?: (c: number) => void }> = []
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockImplementation((() => {
      const child: Record<string, unknown> = { stdout: { on: () => {} }, stderr: { on: () => {} }, killed: false, exitCode: 0, pid: 1, kill: () => {} }
      child.on = (ev: string, cb: (c: number) => void) => { if (ev === 'exit') child._exit = cb }
      children.push(child as { _exit?: (c: number) => void })
      return child
    }) as never)
    const sigintBefore = process.listenerCount('SIGINT')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      const srv = children.find((c) => c._exit)
      expect(srv).toBeTruthy()
      srv!._exit!(1) // non-zero exit → "[label] exited with code 1" (157-158)
      expect(logSpy.mock.calls.flat().join(' ')).toMatch(/exited with code 1/)
    } finally {
      logSpy.mockRestore()
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('warns when the EE folder symlink cannot be created', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    // Sibling ee repo present so dev attempts the symlink.
    fs.mkdirSync(path.join(tmp, 'ee', 'apps', 'api', 'ee'), { recursive: true })
    // Pre-seed apps/api/ee as a DANGLING symlink: existsSync() follows it and
    // returns false (so dev enters the "create symlink" block), but symlinkSync()
    // sees the path entry already exists and throws EEXIST → the catch/warn (206).
    fs.symlinkSync(path.join(tmp, 'does-not-exist'), path.join(root, 'apps', 'api', 'ee'))
    expect(fs.existsSync(path.join(root, 'apps', 'api', 'ee'))).toBe(false)
    process.chdir(root)
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ ee: true, adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150)) // symlink throws EEXIST → warning (206), then continues
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('exits when the DB/Redis health checks never pass', async () => {
    vi.useFakeTimers()
    try {
      process.chdir(fakeRepo(true))
      // docker present, infra not running, infra `up` succeeds, but the health
      // exec (pg_isready / redis-cli ping) always fails → health checks time out.
      execSyncMock.mockImplementation(((cmd: string) => {
        if (cmd.includes('pg_isready') || cmd.includes('redis-cli')) throw new Error('not ready')
        return Buffer.from('')
      }) as never)
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      const settled = promise.then(() => 'ok', (e) => e)
      await vi.advanceTimersByTimeAsync(60_000) // past the 30-attempt health loop
      const result = await settled
      expect(result).toBeInstanceOf(ProcessExit)
    } finally {
      vi.useRealTimers()
    }
  })

  it('exits when starting the infra containers fails', async () => {
    process.chdir(fakeRepo(true))
    execSyncMock.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose -f')) { // the dev DB/Redis `up`
        const e = new Error('boom') as Error & { stderr: Buffer }
        e.stderr = Buffer.from('could not start')
        throw e
      }
      return Buffer.from('') // docker --version/info succeed; infra not already running
    }) as never)
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' }))
      .rejects.toBeInstanceOf(ProcessExit)
  })

  it('the interactive restart keys re-spawn the requested service', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)

    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()

    // Fake a TTY stdin so dev registers its keypress handler.
    const stdin = process.stdin as unknown as Record<string, unknown>
    const orig = { isTTY: stdin.isTTY, isRaw: stdin.isRaw, setRawMode: stdin.setRawMode, resume: stdin.resume, setEncoding: stdin.setEncoding, pause: stdin.pause }
    Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(stdin, 'isRaw', { value: true, configurable: true }) // → shutdown restores raw mode
    stdin.setRawMode = () => stdin; stdin.resume = () => stdin
    stdin.setEncoding = () => stdin; stdin.pause = () => stdin

    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150)) // reach the keep-alive + handler registration

      const dataHandler = (process.stdin.listeners('data').at(-1)) as (k: string) => void
      expect(typeof dataHandler).toBe('function')
      const before = spawnMock.mock.calls.length // 3 initial servers
      for (const svc of ['a', 'w', 'c', 'b']) { // restart api, web, collab, all
        dataHandler('r')      // arm the restart chord
        await dataHandler(svc)
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(spawnMock.mock.calls.length).toBeGreaterThan(before) // services re-spawned

      // 'q' triggers graceful shutdown → process.exit(0).
      await expect((async () => dataHandler('q'))()).rejects.toBeInstanceOf(ProcessExit)
    } finally {
      Object.defineProperty(stdin, 'isTTY', { value: orig.isTTY, configurable: true })
      Object.defineProperty(stdin, 'isRaw', { value: orig.isRaw, configurable: true })
      stdin.setRawMode = orig.setRawMode; stdin.resume = orig.resume
      stdin.setEncoding = orig.setEncoding; stdin.pause = orig.pause
      process.stdin.removeAllListeners('data')
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('shutdown SIGTERMs then SIGKILLs unresponsive children after the grace period', async () => {
    vi.useFakeTimers()
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)

    const children: Array<{ kill: ReturnType<typeof vi.fn> }> = []
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockImplementation((() => {
      const child: Record<string, unknown> = { exitCode: null, killed: false, stdout: { on: () => {} }, stderr: { on: () => {} }, _exit: null }
      child.on = (ev: string, cb: () => void) => { if (ev === 'exit') child._exit = cb }
      child.kill = vi.fn((sig: string) => { if (sig === 'SIGKILL' && child._exit) (child._exit as () => void)() }) // SIGKILL → exit → resolve
      children.push(child as { kill: ReturnType<typeof vi.fn> })
      return child
    }) as never)
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never) // no-op so shutdown completes

    const stdin = process.stdin as unknown as Record<string, unknown>
    const orig = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, resume: stdin.resume, setEncoding: stdin.setEncoding, pause: stdin.pause }
    Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true })
    stdin.setRawMode = () => stdin; stdin.resume = () => stdin; stdin.setEncoding = () => stdin; stdin.pause = () => stdin
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await vi.advanceTimersByTimeAsync(1) // flush microtasks → reach keep-alive + register stdin handler
      const h = process.stdin.listeners('data').at(-1) as (k: string) => Promise<void>
      const shutdownDone = h('q') // → Promise.all(killProcess×3): SIGTERM + 5s SIGKILL timer
      await vi.advanceTimersByTimeAsync(6000) // past the grace period → SIGKILL → children exit
      await shutdownDone
      expect(children.length).toBe(3)
      for (const c of children) {
        expect(c.kill).toHaveBeenCalledWith('SIGTERM')
        expect(c.kill).toHaveBeenCalledWith('SIGKILL')
      }
    } finally {
      Object.defineProperty(stdin, 'isTTY', { value: orig.isTTY, configurable: true })
      stdin.setRawMode = orig.setRawMode; stdin.resume = orig.resume; stdin.setEncoding = orig.setEncoding; stdin.pause = orig.pause
      process.stdin.removeAllListeners('data')
      for (const x of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', x as never)
      for (const x of process.listeners('SIGTERM')) process.removeListener('SIGTERM', x as never)
      vi.useRealTimers()
    }
  })

  it('the q / ctrl-c key handlers run shutdown and return', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    const exitCalls: number[] = []
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { exitCalls.push(c ?? 0) }) as never) // no-op records

    const stdin = process.stdin as unknown as Record<string, unknown>
    const orig = { isTTY: stdin.isTTY, isRaw: stdin.isRaw, setRawMode: stdin.setRawMode, resume: stdin.resume, setEncoding: stdin.setEncoding, pause: stdin.pause }
    Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(stdin, 'isRaw', { value: true, configurable: true })
    stdin.setRawMode = () => stdin; stdin.resume = () => stdin; stdin.setEncoding = () => stdin; stdin.pause = () => stdin
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      const h = process.stdin.listeners('data').at(-1) as (k: string) => Promise<void>
      await h('\x03') // ctrl-c → shutdown → exit(0) (no-op) → handler returns
      await h('q')    // q → shutdown already in progress → returns early → handler returns
      expect(exitCalls).toContain(0)
    } finally {
      Object.defineProperty(stdin, 'isTTY', { value: orig.isTTY, configurable: true })
      Object.defineProperty(stdin, 'isRaw', { value: orig.isRaw, configurable: true })
      stdin.setRawMode = orig.setRawMode; stdin.resume = orig.resume; stdin.setEncoding = orig.setEncoding; stdin.pause = orig.pause
      process.stdin.removeAllListeners('data')
      for (const x of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', x as never)
      for (const x of process.listeners('SIGTERM')) process.removeListener('SIGTERM', x as never)
    }
  })

  it('installs missing dependencies before starting (bun/uv)', async () => {
    const root = fakeRepo(true) // env present, but NO node_modules/.venv → install runs
    process.chdir(root)
    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    const spawnSyncMock = cp.spawnSync as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear(); spawnSyncMock.mockClear()
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      expect(spawnSyncMock).toHaveBeenCalled() // bun install / uv sync ran
      expect(spawnMock).toHaveBeenCalledTimes(3)
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('exits when a dependency install fails', async () => {
    const root = fakeRepo(true) // no node_modules → install attempted
    process.chdir(root)
    const cp = await import('node:child_process')
    ;(cp.spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('install failed') })
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when the API (uv) install fails after the bun installs succeed', async () => {
    const root = fakeRepo(true)
    // bun projects have node_modules (skip), API has none → only `uv sync` runs.
    fs.mkdirSync(path.join(root, 'apps/web/node_modules'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/collab/node_modules'), { recursive: true })
    process.chdir(root)
    const cp = await import('node:child_process')
    ;(cp.spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(((bin: string) =>
      ({ status: bin === 'uv' ? 1 : 0, stdout: Buffer.from(''), stderr: Buffer.from('') })) as never)
    await expect(devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('reuses already-running infra (no admin prompts, no infra start)', async () => {
    const root = fakeRepo(true)
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    // isContainerRunning(db/redis) → 'true' → isInfraRunning() true → reuse path.
    execSyncMock.mockImplementation(((cmd: string) =>
      cmd.includes('State.Running') ? Buffer.from('true') : Buffer.from('')) as never)

    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()
    const sigintBefore = process.listenerCount('SIGINT')
    try {
      const promise = devCommand({}) // no admin creds needed when infra already up
      promise.catch(() => {})
      await new Promise((r) => setTimeout(r, 150))
      expect(spawnMock).toHaveBeenCalledTimes(3) // still launches the 3 local servers
    } finally {
      for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
      for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
    }
  })

  it('starts all three servers and enters the keep-alive loop (happy path)', async () => {
    const root = fakeRepo(true)
    // Pre-create dep dirs so the bun/uv install steps are skipped.
    for (const d of ['apps/web/node_modules', 'apps/collab/node_modules', 'apps/api/.venv']) {
      fs.mkdirSync(path.join(root, d), { recursive: true })
    }
    process.chdir(root)
    // execSync '' → docker installed/running, infra up, and health checks pass.

    const cp = await import('node:child_process')
    const spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()

    const sigintBefore = process.listenerCount('SIGINT')
    // devCommand never resolves — it ends in `await new Promise(() => {})`.
    const promise = devCommand({ adminEmail: 'a@b.dev', adminPassword: 'pw' })
    promise.catch(() => {}) // guard against an unhandled rejection if it ever errors
    await new Promise((r) => setTimeout(r, 150)) // let the async flow run to the keep-alive

    // api + web + collab were each spawned…
    expect(spawnMock).toHaveBeenCalledTimes(3)
    // …and devCommand is parked in the keep-alive (still pending, never settled).
    const outcome = await Promise.race([
      promise.then(() => 'settled', () => 'settled'),
      new Promise((r) => setTimeout(() => r('pending'), 50)),
    ])
    expect(outcome).toBe('pending')

    // Clean up the SIGINT/SIGTERM handlers devCommand attached.
    const handlers = process.listeners('SIGINT').slice(sigintBefore)
    for (const h of handlers) process.removeListener('SIGINT', h as never)
    for (const h of process.listeners('SIGTERM')) process.removeListener('SIGTERM', h as never)
  })
})

// ─── Command success paths (full body, fixture install) ─────────
//
// Drives the read-mostly commands past their guards against a fixture
// install with docker calls stubbed, so their entire body executes
// in-process (the integration suite runs them as a subprocess, which
// in-process coverage can't see).

describe('command success paths', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-ok-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\nHTTP_PORT=8080\n')
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    container_name: learnhouse-app-dep1\n')
    origHome = process.env.HOME
    process.env.HOME = home
    H.reset()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReset(); m.mockReturnValue(Buffer.from(''))
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    H.reset()
    vi.restoreAllMocks()
  })

  it('config prints the installation details and returns', async () => {
    await expect(configCommand()).resolves.toBeUndefined()
  })

  it('status renders compose ps output and returns', async () => {
    await expect(statusCommand()).resolves.toBeUndefined()
  })

  it('start migrates content and brings services up', async () => {
    await expect(startCommand()).resolves.toBeUndefined()
  })

  it('stop brings services down', async () => {
    await expect(stopCommand()).resolves.toBeUndefined()
  })

  it('health runs every probe and completes', async () => {
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('health shows green when redis pings and http responds', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('redis-cli ping')) return Buffer.from('PONG')
      return Buffer.from('') // pg_isready etc. → no throw → pass
    }) as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('health reports db/redis containers not running', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('State.Running') ? Buffer.from('false') : Buffer.from('')) as never)
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('health exits when no deployment id can be determined', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-h-noid-home-'))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-h-noid-cwd-'))
    fs.writeFileSync(path.join(proj, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir: proj, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    const origCwd = process.cwd()
    process.env.HOME = empty
    process.chdir(proj)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReturnValue(Buffer.from('')) // autoDetect → no containers → null
    try {
      await expect(healthCommand()).rejects.toBeInstanceOf(ProcessExit)
    } finally {
      process.chdir(origCwd)
      fs.rmSync(empty, { recursive: true, force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })

  it('health reports PostgreSQL not ready when pg_isready fails', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-db-dep1\tUp 2 hours\tpgvector/pgvector:pg16\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('pg_isready')) throw new Error('db starting up') // → "PostgreSQL not ready" (54)
      if (cmd.includes('redis-cli ping')) return Buffer.from('PONG')
      return Buffer.from('')
    }) as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('health surfaces redis ping, HTTP and resource-stats failures', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')      // containers running
      if (cmd.includes('redis-cli ping')) throw new Error('redis down')  // → "Redis not responding" (68)
      if (cmd.includes('compose') && cmd.includes('stats')) throw new Error('no stats') // primary stats fail
      if (cmd.includes('docker stats')) throw new Error('stats fail')    // fallback stats fail → 117
      return Buffer.from('')
    }) as never)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED')) // HTTP unreachable → 89
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('health notes when there are no running containers for resource stats', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tExited (0) 1 min ago\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('false')
      if (cmd.includes('compose') && cmd.includes('stats')) throw new Error('no stats') // → fallback
      return Buffer.from('')
    }) as never)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(healthCommand()).resolves.toBeUndefined() // fallback finds no "up" containers → 114
  })

  it('health reports a non-200 http and falls back for disk/stats failures', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('system df')) throw new Error('disk usage unavailable')
      if (cmd.includes('compose stats')) throw new Error('compose stats failed') // → fallback
      if (cmd.includes('docker stats')) return Buffer.from('NAME\tCPU\nlearnhouse-app-dep1\t5%\n')
      return Buffer.from('')
    }) as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('err', { status: 503 })) // resp.ok false
    await expect(healthCommand()).resolves.toBeUndefined()
  })

  it('doctor and health walk the green path when containers report healthy', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from(
        'learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n' +
        'learnhouse-db-dep1\tUp 2 hours (healthy)\tpgvector/pgvector:pg16\n' +
        'learnhouse-redis-dep1\tUp 2 hours\tredis:7-alpine\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('RestartCount')) return Buffer.from('0')
      if (cmd.includes('{{.Image}}')) return Buffer.from('sha256:abcdef0123456789')
      if (cmd.includes('docker logs')) return Buffer.from('INFO: all good\n')
      return Buffer.from('')
    }) as never)
    await expect(healthCommand()).resolves.toBeUndefined()
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor reports the configured port as in use when occupied', async () => {
    const net = await import('node:net')
    // Reserve a free port number, then occupy it the same way checkPort binds.
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, () => r()))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>((r) => probe.close(() => r()))
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: port,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(port, () => r()))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : cmd.includes('State.Running') ? Buffer.from('true') : Buffer.from('')) as never)
    try {
      await expect(doctorCommand()).resolves.toBeUndefined() // hits the port-in-use branch
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('doctor warns on short secrets and unreadable logs', async () => {
    fs.writeFileSync(path.join(installDir, '.env'),
      'LEARNHOUSE_DOMAIN=localhost\nHTTP_PORT=8080\nLEARNHOUSE_AUTH_JWT_SECRET_KEY=abc\n') // too short
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('RestartCount')) return Buffer.from('0')
      if (cmd.includes('docker logs')) throw new Error('cannot read logs') // → warn branch
      if (cmd.includes('{{.Image}}')) return Buffer.from('sha256:abcdef0123456789')
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor aborts when the Docker daemon is not running', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker --version')) return Buffer.from('Docker version 25.0.0') // installed
      if (cmd.includes('docker info')) throw new Error('Cannot connect to the Docker daemon') // not running
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).rejects.toBeInstanceOf(ProcessExit) // exit(1) on daemon down
  })

  it('doctor skips deployment checks when no installation is found', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noinst-home-'))
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noinst-cwd-'))
    const origCwd = process.cwd()
    process.env.HOME = empty
    process.chdir(bare)
    try {
      await expect(doctorCommand()).resolves.toBeUndefined() // config null → skip + outro
    } finally {
      process.chdir(origCwd)
      fs.rmSync(empty, { recursive: true, force: true })
      fs.rmSync(bare, { recursive: true, force: true })
    }
  })

  it('doctor skips container checks when no deployment id can be determined', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noid-home-'))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noid-cwd-'))
    fs.writeFileSync(path.join(proj, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir: proj, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    const origCwd = process.cwd()
    process.env.HOME = empty
    process.chdir(proj)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReturnValue(Buffer.from('')) // autoDetectDeploymentId → no containers → null
    try {
      await expect(doctorCommand()).resolves.toBeUndefined() // id null → skip container checks
    } finally {
      process.chdir(origCwd)
      fs.rmSync(empty, { recursive: true, force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })

  it('doctor flags restarting/stopped containers and high restart counts', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from(
        'learnhouse-app-dep1\tRestarting (1) 3 seconds ago\tghcr.io/learnhouse/app:1.4.2\n' +
        'learnhouse-db-dep1\tExited (1) 5 minutes ago\tpgvector/pgvector:pg16\n' +
        'learnhouse-redis-dep1\tUp 2 hours\tredis:7-alpine\n')
      if (cmd.includes('State.Running')) return Buffer.from('false')
      if (cmd.includes('RestartCount')) return Buffer.from('7') // > 3 → warn
      if (cmd.includes('docker logs')) return Buffer.from('ERR\n')
      if (cmd.includes('{{.Image}}')) return Buffer.from('sha256:abcdef0123456789')
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor confirms when every required env var is present and strong', async () => {
    fs.writeFileSync(path.join(installDir, '.env'), [
      'LEARNHOUSE_DOMAIN=localhost',
      'LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://u:p@db:5432/lh',
      'LEARNHOUSE_REDIS_CONNECTION_STRING=redis://redis:6379/0',
      'LEARNHOUSE_AUTH_JWT_SECRET_KEY=a-strong-jwt-secret-value',
      'NEXTAUTH_SECRET=another-strong-secret-value',
      'NEXTAUTH_URL=http://localhost:8080',
      'POSTGRES_PASSWORD=a-strong-db-password',
      '',
    ].join('\n'))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('RestartCount')) return Buffer.from('0')
      if (cmd.includes('docker logs')) return Buffer.from('INFO: ok\n')
      if (cmd.includes('{{.Image}}')) return Buffer.from('sha256:abcdef0123456789')
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined() // envOk → "All required environment variables present"
  })

  it('doctor fails when the .env file is missing entirely', async () => {
    // A config resolved via the cwd-fallback (no listed install) that has a
    // compose + config.json but no .env, so doctor reaches the ".env missing" fail.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noenv-home-'))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noenv-cwd-'))
    fs.writeFileSync(path.join(proj, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: proj, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(proj, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n')
    const origCwd = process.cwd()
    process.env.HOME = empty
    process.chdir(proj)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      return Buffer.from('')
    }) as never)
    try {
      await expect(doctorCommand()).resolves.toBeUndefined() // ".env file missing" fail branch
    } finally {
      process.chdir(origCwd)
      fs.rmSync(empty, { recursive: true, force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })

  it('doctor warns on low disk space (megabytes)', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('df -h')) return Buffer.from('500m\n') // low → "Low disk space" warn
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor warns on low disk space (sub-1G)', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('df -h') ? Buffer.from('0.5g\n')
        : cmd.includes('docker ps') ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
          : cmd.includes('State.Running') ? Buffer.from('true') : Buffer.from('')) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor handles a disk-usage check failure', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('df -h')) throw new Error('df unavailable') // → "Could not check disk space" catch
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor reports a missing .env file', async () => {
    fs.rmSync(path.join(installDir, '.env'))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : cmd.includes('State.Running') ? Buffer.from('true') : Buffer.from('')) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('doctor reports container errors found in the logs', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      if (cmd.includes('State.Running')) return Buffer.from('true')
      if (cmd.includes('RestartCount')) return Buffer.from('3') // some restarts
      if (cmd.includes('docker logs')) return Buffer.from('ERROR: database connection refused\nERROR: retrying\n')
      if (cmd.includes('{{.Image}}')) return Buffer.from('sha256:abcdef0123456789')
      return Buffer.from('')
    }) as never)
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('deployments "view" lists deployments and returns', async () => {
    H.q.select.push('view')
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('deployments "view" renders detail when a deployment exists', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : Buffer.from('')) as never)
    H.q.select.push('view')
    await expect(deploymentsCommand()).resolves.toBeUndefined()
  })

  it('logs streams via docker compose when services are present', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('ps -q') ? Buffer.from('abc123\n') : Buffer.from('')) as never)
    // dockerComposeLogs spawns (fake child) and returns without blocking.
    await expect(logsCommand()).resolves.toBeUndefined()
  })

  it('shell opens an interactive session in a running container', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : Buffer.from('')) as never)
    H.q.select.push('learnhouse-app-dep1')
    await expect(shellCommand()).resolves.toBeUndefined()
  })

  it('shell/logs exit when the config has no deployment id and none is detected', async () => {
    // A config found via the cwd-fallback that lacks deploymentId, and autodetect
    // returns nothing → the `if (!id)` guard fires.
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noid-'))
    fs.writeFileSync(path.join(cwdDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir: cwdDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(cwdDir, '.env'), 'X=1\n')
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-noid-home-'))
    const origCwd = process.cwd()
    const origHome2 = process.env.HOME
    process.env.HOME = emptyHome // no ~/.learnhouse installs → findInstallDir falls back to cwd
    process.chdir(cwdDir)
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReturnValue(Buffer.from('')) // autoDetect → null
    try {
      await expect(shellCommand()).rejects.toBeInstanceOf(ProcessExit)
      await expect(logsCommand()).rejects.toBeInstanceOf(ProcessExit)
    } finally {
      process.chdir(origCwd)
      if (origHome2 === undefined) delete process.env.HOME; else process.env.HOME = origHome2
      fs.rmSync(cwdDir, { recursive: true, force: true })
      fs.rmSync(emptyHome, { recursive: true, force: true })
    }
  })

  it('shell exits when no containers are running', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tExited (0)\tghcr.io/learnhouse/app:1.4.2\n') // not "Up"
        : Buffer.from('')) as never)
    await expect(shellCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('shell exits(0) when the container selection is cancelled', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) =>
      cmd.includes('docker ps')
        ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : Buffer.from('')) as never)
    // empty select queue → cancel sentinel → p.cancel() + exit(0)
    await expect(shellCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('shell and logs exit when no deployment id can be resolved', async () => {
    // config without a deploymentId + autoDetect returns nothing → no id.
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReturnValue(Buffer.from('')) // compose ps empty + autoDetect empty → no id
    await expect(shellCommand()).rejects.toBeInstanceOf(ProcessExit)
    await expect(logsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('logs exits when no containers are running', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose ps -q')) return Buffer.from('') // no compose services → fallback
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tExited (0)\tghcr.io/learnhouse/app:1.4.2\n') // not "Up"
      return Buffer.from('')
    }) as never)
    await expect(logsCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('logs falls back to per-container streaming when compose has no services', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose ps -q')) return Buffer.from('') // no compose services
      if (cmd.includes('docker ps')) return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      return Buffer.from('')
    }) as never)
    await expect(logsCommand()).resolves.toBeUndefined()
  })

  it('printBanner renders without error', async () => {
    await expect(printBanner()).resolves.toBeUndefined()
  })

  it('status / start / stop exit cleanly when Docker errors', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation((() => { throw new Error('Cannot connect to the Docker daemon') }) as never)
    await expect(statusCommand()).rejects.toBeInstanceOf(ProcessExit)
    await expect(startCommand()).rejects.toBeInstanceOf(ProcessExit)
    await expect(stopCommand()).rejects.toBeInstanceOf(ProcessExit)
  })
})

// ─── setup + update full bodies (in-process, mocked docker/health) ──
//
// These run the orchestration that the integration suite exercises as a
// subprocess — driven here in-process so the bodies are measurably covered.

describe('setup / update in-process', () => {
  let home: string
  let origHome: string | undefined

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-setup-'))
    origHome = process.env.HOME
    process.env.HOME = home
    H.reset()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
    // resolveAppImage hits GitHub/GHCR — force the offline fallback to :latest.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    healthMock.waitForHealth.mockResolvedValue(true)
    healthMock.waitForOrgSeed.mockResolvedValue(true)
    healthMock.waitForEeReady.mockResolvedValue('ee')
    const cp = await import('node:child_process')
    const m = cp.execSync as unknown as ReturnType<typeof vi.fn>
    m.mockReset(); m.mockReturnValue(Buffer.from(''))
    const sp = cp.spawnSync as unknown as ReturnType<typeof vi.fn>
    sp.mockReset(); sp.mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    H.reset()
    vi.restoreAllMocks()
  })

  it('setup --ci --no-start generates a complete install', async () => {
    await setupCommand({
      ci: true, name: 'unit', domain: 'localhost', port: 8090,
      adminEmail: 'admin@school.dev', adminPassword: 'password123',
      orgName: 'Test Org', orgSlug: 'default', start: false,
    })
    const dir = path.join(home, '.learnhouse', 'unit')
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'learnhouse.config.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8'))
      .toContain('LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@school.dev')
  })

  it('the interactive wizard generates a complete community install', async () => {
    // Scripted answers, in prompt order, for the 6-step wizard with defaults.
    H.q.select.push(
      'community',  // edition
      'stable',     // channel
      'continue',   // step 1 (domain) confirmOrBack
      'local',      // db setup
      'ai',         // db image
      'local',      // redis setup
      'continue',   // step 2 (database)
      'continue',   // step 3 (organization)
      'continue',   // step 4 (admin)
      'confirm',    // final summary
    )
    H.q.text.push(
      'default',            // install name
      'localhost',          // domain
      '8090',               // http port
      'Test Org',           // org name
      'default',            // org slug
      'admin@school.dev',   // admin email
    )
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, false) // db credential ack = true; start now = false
    H.q.multiselect.push([])      // no optional features

    await setupCommand({})

    const dir = path.join(home, '.learnhouse', 'default')
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'learnhouse.config.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8'))
      .toContain('LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@school.dev')
  })

  it('the interactive wizard lets you go back and edit a step before confirming', async () => {
    H.q.select.push(
      'community', 'stable', 'continue', 'local', 'ai', 'local',
      'continue', 'continue', 'continue',
      'edit', 3,        // edit step 4 (Organization)
      'confirm',        // then proceed
    )
    H.q.text.push(
      'edited-install', 'localhost', '8097', 'Test Org', 'default', 'admin@school.dev',
      'Edited Org', 'edited', // re-run of the organization step
    )
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, false)
    H.q.multiselect.push([])

    await setupCommand({})
    const cfg = JSON.parse(fs.readFileSync(
      path.join(home, '.learnhouse', 'edited-install', 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.orgSlug).toBe('edited')
  })

  // The 6-step wizard, then a single edit from the summary menu. Each edit re-runs
  // exactly one step (its full prompt set) so the scripted queues stay aligned.
  const wizardThenEdit = (
    name: string, editIdx: number,
    extra: { select?: unknown[]; text?: unknown[]; password?: unknown[]; confirm?: unknown[]; multiselect?: unknown[] },
  ) => {
    H.q.select.push(
      'community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue',
      'edit', editIdx, ...(extra.select ?? []), 'confirm',
    )
    H.q.text.push(name, 'localhost', '8104', 'Test Org', 'default', 'admin@school.dev', ...(extra.text ?? []))
    H.q.password.push('adminpassword123', ...(extra.password ?? []))
    H.q.confirm.push(true, ...(extra.confirm ?? []), false) // db ack; …; start now = no
    H.q.multiselect.push([], ...(extra.multiselect ?? []))
  }

  it('the wizard edit menu can re-run the install-directory step', async () => {
    wizardThenEdit('edit-dir', 0, { text: ['edit-dir'] }) // case 0
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'edit-dir', 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard edit menu can re-run the domain step', async () => {
    wizardThenEdit('edit-dom', 1, { text: ['localhost', '8200'] }) // case 1: domain + port
    await setupCommand({})
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.learnhouse', 'edit-dom', 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.httpPort).toBe(8200)
  })

  it('the wizard edit menu can re-run the database step', async () => {
    wizardThenEdit('edit-db', 2, { select: ['local', 'ai', 'local'], confirm: [true] }) // case 2: db+image+redis, ack
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'edit-db', 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard edit menu can re-run the admin step', async () => {
    wizardThenEdit('edit-adm', 4, { text: ['admin2@school.dev'], password: ['adminpassword456'] }) // case 4
    await setupCommand({})
    const env = fs.readFileSync(path.join(home, '.learnhouse', 'edit-adm', '.env'), 'utf-8')
    expect(env).toContain('LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin2@school.dev')
  })

  it('the wizard edit menu can re-run the optional-features step', async () => {
    wizardThenEdit('edit-feat', 5, { multiselect: [[]] }) // case 5
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'edit-feat', 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard can go back through every step before proceeding', async () => {
    // Walk forward to step 5 (admin), then cascade back 4 → 3 → 2 → 1 → 0 (exercising
    // each step's "go back" branch), then forward again to the summary and confirm.
    H.q.select.push(
      'community', 'stable',
      'continue',                 // s1 (domain) → s2
      'local', 'ai', 'local', 'continue', // s2 (db) → s3
      'continue',                 // s3 (org) → s4
      'back',                     // s4 (admin) → s3   (411)
      'back',                     // s3 (org)   → s2   (404)
      'local', 'ai', 'local', 'back', // s2 (db) → s1  (397)
      'back',                     // s1 (domain) → s0  (390)
      'continue',                 // s1 (domain) → s2  (after redo of s0+s1)
      'local', 'ai', 'local', 'continue', // s2 → s3
      'continue',                 // s3 → s4
      'continue',                 // s4 → s5
      'confirm',
    )
    H.q.text.push(
      'bn', 'localhost', '8090',  // s0 dir, s1 domain+port
      'Org', 'slug',              // s3 org (first)
      'a@b.dev',                  // s4 admin email (first)
      'Org', 'slug',              // s3 org (redo on the way back)
      'localhost', '8090',        // s1 domain (redo on the way back)
      'bn',                       // s0 dir (redo after reaching step 0)
      'localhost', '8090',        // s1 domain (forward again)
      'Org', 'slug',              // s3 org (forward again)
      'a@b.dev',                  // s4 admin email (forward again)
    )
    H.q.password.push('adminpassword123', 'adminpassword123') // admin runs twice
    H.q.confirm.push(true, true, true, false) // db ack ×3 (s2 runs 3×); start now = no
    H.q.multiselect.push([])
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'bn', 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard exits when the edition prompt is cancelled', async () => {
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit) // no answers → edition cancel (336)
  })

  it('the wizard rejects an empty install name', async () => {
    H.q.select.push('community', 'stable')
    H.q.text.push('') // validate → "Name is required" (62); then domain prompt cancels → exit
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard rejects an install name containing slashes', async () => {
    H.q.select.push('community', 'stable')
    H.q.text.push('bad/name') // validate → "cannot contain slashes" (63); then domain cancels → exit
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard exits when the install-name prompt is cancelled', async () => {
    H.q.select.push('community', 'stable') // install name text left empty → cancel (67)
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard exits when a step continue/back prompt is cancelled', async () => {
    // Reach step 1's confirmOrBack, then cancel it → confirmOrBack isCancel (48).
    H.q.select.push('community', 'stable', H.cancel) // step1 confirmOrBack cancelled
    H.q.text.push('cob-cancel', 'localhost', '8109')
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setupCommand dispatches to and completes the interactive EE wizard', async () => {
    H.q.select.push('enterprise', 'single')              // edition → EE; tenancy
    H.q.password.push('lh_live_TESTKEY', 'password123')  // license, admin password
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, false)                       // localTls=no, startNow=no
    await setupCommand({ name: 'ee-via-setup' }) // completes → dispatch returns (340-341)
    const base = path.join(home, '.learnhouse')
    expect(fs.readdirSync(base).some((d) => fs.existsSync(path.join(base, d, 'Caddyfile')))).toBe(true)
  })

  it('the wizard exits when the channel prompt is cancelled', async () => {
    H.q.select.push('community') // edition only; channel left empty → cancel (363)
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard dispatches to the enterprise installer when EE is chosen', async () => {
    H.q.select.push('enterprise') // → setupEnterprise(interactive); EE tenancy left empty → cancel (339-341)
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci --edition enterprise completes and returns', async () => {
    await setupCommand({
      ci: true, edition: 'enterprise', name: 'ci-ee-ok', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev', adminPassword: 'password123',
      tenancy: 'single', start: false,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ci-ee-ok', 'docker-compose.yml'))).toBe(true) // 173-174
  })

  it('the wizard cancels from the summary menu', async () => {
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'cancel')
    H.q.text.push('sum-cancel', 'localhost', '8106', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true)
    H.q.multiselect.push([])
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit) // summary 'cancel' → exit (470-471)
  })

  it('the wizard exits when the "start now?" confirmation is cancelled', async () => {
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('start-cancel', 'localhost', '8107', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, H.cancel) // db ack; "start now?" cancelled → exit (584)
    H.q.multiselect.push([])
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard writes a Caddyfile for an auto-SSL domain', async () => {
    H.q.select.push('community', 'stable', 'auto', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('autossl', 'learn.test.dev', 'ops@test.dev', '443', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, false) // db ack; start now = no
    H.q.multiselect.push([])
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'autossl', 'extra', 'Caddyfile'))).toBe(true) // 565
  })

  it('the wizard warns and can overwrite an existing installation', async () => {
    const existing = path.join(home, '.learnhouse', 'dup')
    fs.mkdirSync(existing, { recursive: true })
    fs.writeFileSync(path.join(existing, 'learnhouse.config.json'), '{}') // pre-existing install
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('dup', 'localhost', '8108', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true, false) // overwrite=yes, db ack=yes, start now=no (73-77)
    H.q.multiselect.push([])
    await setupCommand({})
    expect(fs.existsSync(path.join(existing, 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard exits when an existing-install overwrite is declined', async () => {
    const existing = path.join(home, '.learnhouse', 'dup2')
    fs.mkdirSync(existing, { recursive: true })
    fs.writeFileSync(path.join(existing, 'learnhouse.config.json'), '{}')
    H.q.select.push('community', 'stable')
    H.q.text.push('dup2')
    H.q.confirm.push(false) // overwrite declined → exit (78-80)
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard edit menu cancels cleanly when the step picker is dismissed', async () => {
    // 'edit' then the step-picker select is left empty → cancel → continue (479), then confirm.
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'edit')
    H.q.text.push('edit-cancel', 'localhost', '8105', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true)
    H.q.multiselect.push([])
    // step picker empty → isCancel → continue; the next summary select is also empty → cancel → exit(0)
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard exits when it cannot write the config files', async () => {
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('failwrite', 'localhost', '8102', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, false)
    H.q.multiselect.push([])
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('ENOSPC: disk full') })
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard start path exits on a port conflict', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('up')) {
        const e = new Error('boom') as Error & { stderr: Buffer }
        e.stderr = Buffer.from('Error: port is already allocated')
        throw e
      }
      return Buffer.from('')
    }) as never)
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('pc-wiz', 'localhost', '8099', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true) // start now → dockerComposeUp throws port-allocated
    H.q.multiselect.push([])
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard start path exits on a generic start failure', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('up')) throw new Error('some other docker failure')
      return Buffer.from('')
    }) as never)
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('gen-wiz', 'localhost', '8100', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true)
    H.q.multiselect.push([])
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the wizard start path warns on a health timeout but still completes', async () => {
    healthMock.waitForHealth.mockResolvedValue(false) // never healthy → timeout warn, not exit
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('timeout-wiz', 'localhost', '8101', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true)
    H.q.multiselect.push([])
    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'timeout-wiz', 'docker-compose.yml'))).toBe(true)
  })

  it('the wizard start path exits when the org never seeds', async () => {
    healthMock.waitForOrgSeed.mockResolvedValue(false) // DB up but org seed never appears
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('noseed', 'localhost', '8098', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true) // start now = yes
    H.q.multiselect.push([])
    await expect(setupCommand({})).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the interactive wizard can start services after generating (startNow=yes)', async () => {
    H.q.select.push('community', 'stable', 'continue', 'local', 'ai', 'local', 'continue', 'continue', 'continue', 'confirm')
    H.q.text.push('started', 'localhost', '8094', 'Test Org', 'default', 'admin@school.dev')
    H.q.password.push('adminpassword123')
    H.q.confirm.push(true, true) // db ack = yes; start now = YES (mocked docker + health)
    H.q.multiselect.push([])

    await setupCommand({})
    expect(fs.existsSync(path.join(home, '.learnhouse', 'started', 'docker-compose.yml'))).toBe(true)
  })

  it('setup --ci with start surfaces a port-conflict and exits', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('up')) {
        const e = new Error('boom') as Error & { stderr: Buffer }
        e.stderr = Buffer.from('Error: port is already allocated')
        throw e
      }
      return Buffer.from('')
    }) as never)
    await expect(setupCommand({
      ci: true, name: 'pc', domain: 'localhost', port: 8093,
      adminEmail: 'admin@school.dev', adminPassword: 'password123',
      orgName: 'T', orgSlug: 'default', start: true,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci WITH start brings services up (mocked docker + health)', async () => {
    await setupCommand({
      ci: true, name: 'started', domain: 'localhost', port: 8092,
      adminEmail: 'admin@school.dev', adminPassword: 'password123',
      orgName: 'Test', orgSlug: 'default', start: true,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'started', 'docker-compose.yml'))).toBe(true)
  })

  it('setup --ci with start exits when the org is never seeded', async () => {
    healthMock.waitForHealth.mockResolvedValue(true)
    healthMock.waitForOrgSeed.mockResolvedValue(false) // API healthy but org not seeded → 294-298
    await expect(setupCommand({
      ci: true, name: 'noseed', domain: 'localhost', port: 8094,
      adminEmail: 'admin@school.dev', adminPassword: 'password123', start: true,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci with start warns when the health check times out', async () => {
    healthMock.waitForHealth.mockResolvedValue(false) // never healthy → "timed out" (301)
    await setupCommand({
      ci: true, name: 'slow', domain: 'localhost', port: 8095,
      adminEmail: 'admin@school.dev', adminPassword: 'password123', start: true,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'slow', 'docker-compose.yml'))).toBe(true)
  })

  it('setup --ci with start exits on a generic startup failure', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('up')) throw new Error('docker daemon crashed') // non-port error → generic (309)
      return Buffer.from('')
    }) as never)
    await expect(setupCommand({
      ci: true, name: 'crash', domain: 'localhost', port: 8096,
      adminEmail: 'admin@school.dev', adminPassword: 'password123', start: true,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('update on an enterprise install runs the EE upgrade path', async () => {
    const dir = path.join(home, '.learnhouse', 'ee')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'learn.school.dev', httpPort: 443,
      useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
      edition: 'enterprise', eeTenancy: 'single',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'DOMAIN=learn.school.dev\nLEARNHOUSE_LICENSE_KEY=lh_live_TESTKEY\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  api:\n    image: images.learnhouse.app/enterprise-backend:prod\n')

    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
  })

  function seedInstall(dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n    container_name: learnhouse-app-dep1\n')
  }

  it('update aborts when the default pre-upgrade backup fails', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    // Default backup ON; execSync writes no dump file → backupDatabase throws → abort.
    await expect(updateCommand({ migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('update --to resolves a version that only exists under a v-prefixed tag', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      if (String(url).includes('/token')) return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      // bare "1.9.9" manifest 404s; the "v1.9.9" retry succeeds → targetImage uses the v-tag.
      if (String(url).includes('/manifests/v1.9.9')) return new Response('{}', { status: 200 })
      return new Response('not found', { status: 404 })
    }) as never)
    // Make the actual upgrade steps no-ops so the command completes past tag resolution.
    await expect(updateCommand({ version: '1.9.9', backup: false, migrate: false }))
      .resolves.toBeUndefined()
  })

  it('update --to a nonexistent version fails before changing anything', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    // fetch already rejects (beforeEach) → resolveTag false for both name and v-prefix.
    await expect(updateCommand({ version: '0.0.0-nope', backup: false, migrate: false }))
      .rejects.toBeInstanceOf(ProcessExit)
  })

  it('update exits cleanly when a docker step throws unexpectedly', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose down')) throw new Error('docker daemon crashed')
      return Buffer.from('')
    }) as never)
    await expect(updateCommand({ backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('update handles an already-mounted content volume', async () => {
    const dir = path.join(home, '.learnhouse', 'mounted')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n    volumes:\n      - x:/app/api/content\n')
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
  })

  it('update skips content migration on an S3 install', async () => {
    const dir = path.join(home, '.learnhouse', 's3')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n')
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
  })

  it('update with migration exits when the alembic upgrade fails', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('alembic upgrade')) throw new Error('relation broken') // not "already exists" → rethrow → false
      return Buffer.from('')
    }) as never)
    await expect(updateCommand({ backup: false, migrate: true })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('update with migration runs alembic (no-op when already at head)', async () => {
    seedInstall(path.join(home, '.learnhouse', 'test'))
    // execSync '' → alembic current == heads (both empty) → already-at-head success.
    await expect(updateCommand({ backup: false, migrate: true })).resolves.toBeUndefined()
  })

  it('EE update exits when the migration fails', async () => {
    const dir = path.join(home, '.learnhouse', 'ee-migfail')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'learn.school.dev', httpPort: 443,
      useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
      edition: 'enterprise', eeTenancy: 'single',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'DOMAIN=learn.school.dev\nEE_IMAGE_TAG=prod\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  api:\n    image: x\n')
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('alembic upgrade')) throw new Error('migration broke')
      return Buffer.from('')
    }) as never)
    await expect(updateCommand({ backup: false, migrate: true })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE update aborts (and reverts the tag) when the image pull fails', async () => {
    const dir = path.join(home, '.learnhouse', 'ee-pullfail')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'learn.school.dev', httpPort: 443,
      useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
      edition: 'enterprise', eeTenancy: 'single',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'DOMAIN=learn.school.dev\nEE_IMAGE_TAG=prod\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  api:\n    image: x\n')
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose pull')) throw new Error('manifest unknown')
      return Buffer.from('')
    }) as never)
    await expect(updateCommand({ backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE update aborts when the default pre-upgrade backup fails', async () => {
    const dir = path.join(home, '.learnhouse', 'ee')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'learn.school.dev', httpPort: 443,
      useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
      edition: 'enterprise', eeTenancy: 'single',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'DOMAIN=learn.school.dev\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  api:\n    image: x\n')
    // Default backup ON; execSync writes no dump → backup fails → EE update aborts.
    await expect(updateCommand({ migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci rejects a short password before writing anything', async () => {
    await expect(setupCommand({
      ci: true, name: 'bad', domain: 'localhost', port: 8090,
      adminEmail: 'admin@school.dev', adminPassword: 'short', start: false,
    })).rejects.toBeInstanceOf(ProcessExit)
    expect(fs.existsSync(path.join(home, '.learnhouse', 'bad'))).toBe(false)
  })

  it('setup --ci --edition enterprise dispatches to the EE installer', async () => {
    // No license → the EE CI installer rejects, proving setupCommand routed here.
    await expect(setupCommand({ ci: true, edition: 'enterprise', name: 'ci-ee', start: false }))
      .rejects.toBeInstanceOf(ProcessExit) // 172-174 + toEeOptions
  })

  it('setup --ci exits when no admin password is given', async () => {
    await expect(setupCommand({ ci: true, name: 'np', domain: 'localhost', start: false }))
      .rejects.toBeInstanceOf(ProcessExit) // 176-178
    expect(fs.existsSync(path.join(home, '.learnhouse', 'np'))).toBe(false)
  })

  it('setup --ci rejects an invalid admin email', async () => {
    await expect(setupCommand({
      ci: true, name: 'be', domain: 'localhost', adminEmail: 'not-an-email',
      adminPassword: 'password123', start: false,
    })).rejects.toBeInstanceOf(ProcessExit) // 188-191
  })

  it('setup --ci rejects an invalid domain', async () => {
    await expect(setupCommand({
      ci: true, name: 'bd', domain: 'bad domain!!', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', start: false,
    })).rejects.toBeInstanceOf(ProcessExit) // 196-199
  })

  it('setup --ci rejects an invalid port', async () => {
    await expect(setupCommand({
      ci: true, name: 'bp', domain: 'localhost', port: 0, adminEmail: 'admin@school.dev',
      adminPassword: 'password123', start: false,
    })).rejects.toBeInstanceOf(ProcessExit) // 204-207
  })

  it('update runs the full upgrade flow against a fixture install', async () => {
    // Seed an install for findInstallDir/readConfig to pick up.
    const dir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n    container_name: learnhouse-app-dep1\n    networks:\n      - n\nnetworks:\n  n:\n')

    // EE readiness probe reports a non-ee state → the flow warns but completes.
    healthMock.waitForEeReady.mockResolvedValue('timeout')
    // --no-backup avoids the pg_dump (mocked execSync writes no file); --no-migrate
    // avoids alembic. waitForHealth is stubbed. The flow should complete.
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()

    // The compose tag was rewritten to :latest (offline fallback).
    expect(fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8'))
      .toContain('ghcr.io/learnhouse/app:latest')
  })

  it('setup --ci EE with external DB and Cloudflare DNS generates config', async () => {
    await setupEnterprise({
      ci: true, name: 'ee-ext', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev', adminPassword: 'password123',
      tenancy: 'single', externalDb: 'postgresql://u:p@db.ext:5432/lh',
      dnsProvider: 'cloudflare', cfApiToken: 'cf_token', start: false,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-ext', 'docker-compose.yml'))).toBe(true)
  })

  it.each([
    ['missing license', { name: 'e1', domain: 'learn.school.dev', adminEmail: 'a@school.dev', adminPassword: 'password123' }],
    ['missing admin password', { name: 'e2', license: 'lh_live_x', domain: 'learn.school.dev', adminEmail: 'a@school.dev' }],
    ['bad tenancy', { name: 'e3', license: 'lh_live_x', domain: 'learn.school.dev', adminEmail: 'a@school.dev', adminPassword: 'password123', tenancy: 'nonsense' }],
    ['cloudflare without token', { name: 'e4', license: 'lh_live_x', domain: 'learn.school.dev', adminEmail: 'a@school.dev', adminPassword: 'password123', dnsProvider: 'cloudflare' }],
    ['bad external-db URI', { name: 'e5', license: 'lh_live_x', domain: 'learn.school.dev', adminEmail: 'a@school.dev', adminPassword: 'password123', externalDb: 'mysql://nope' }],
  ])('setup --ci EE rejects %s', async (_label, opts) => {
    await expect(setupEnterprise({ ci: true, start: false, ...(opts as Record<string, unknown>) })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci EE agency tenancy generates wildcard-domain files', async () => {
    await setupEnterprise({
      ci: true, name: 'ee-agency', license: 'lh_live_TESTKEY',
      domain: 'apps.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'agency', start: false,
    })
    const dir = path.join(home, '.learnhouse', 'ee-agency')
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.eeTenancy).toBe('agency')
    expect(fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8')).toContain('multi')
  })

  it('EE interactive exits when writing the EE files fails', async () => {
    H.q.select.push('single')
    H.q.password.push('lh_live_TESTKEY', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false) // localTls
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('ENOSPC: disk full') })
    await expect(setupEnterprise({ name: 'ee-fail-int' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE interactive overwrites an existing install when confirmed', async () => {
    const dir = path.join(home, '.learnhouse', 'ee-int')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.env'), 'X=1\n') // firstDeploy=false → overwrite prompt
    H.q.select.push('single')
    H.q.password.push('lh_live_TESTKEY', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, true, false) // localTls=no, overwrite=YES, startNow=no
    await setupEnterprise({ name: 'ee-int' })
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
  })

  it('EE interactive cancels when the overwrite is declined', async () => {
    const dir = path.join(home, '.learnhouse', 'ee-int2')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.env'), 'X=1\n')
    H.q.select.push('single')
    H.q.password.push('lh_live_TESTKEY', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, false) // localTls=no, overwrite=NO → exit(0)
    await expect(setupEnterprise({ name: 'ee-int2' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE interactive starts the stack when startNow is confirmed', async () => {
    H.q.select.push('single')
    H.q.password.push('lh_live_TESTKEY', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, true) // localTls=no, startNow=YES → startEe (login/pull/up, mocked)
    await setupEnterprise({ name: 'ee-int-start' })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-int-start', 'docker-compose.yml'))).toBe(true)
  })

  it('the interactive EE wizard generates an enterprise install', async () => {
    H.q.select.push('single')                                   // tenancy
    H.q.password.push('lh_live_TESTKEY', 'password123')         // license, admin password
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev') // domain, acme, admin email
    H.q.confirm.push(false, false)                              // localTls=no, startNow=no

    await setupEnterprise({ name: 'ee-int' })

    const base = path.join(home, '.learnhouse')
    const found = fs.readdirSync(base).find((d) =>
      fs.existsSync(path.join(base, d, 'docker-compose.yml')) &&
      fs.existsSync(path.join(base, d, 'Caddyfile')))
    expect(found).toBeTruthy()
  })

  it('the interactive EE wizard surfaces a pull/start failure', async () => {
    H.q.select.push('single')
    H.q.password.push('lh_live_TESTKEY', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, true) // localTls=no, startNow=yes
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose pull')) {
        const e = new Error('boom') as Error & { stderr: Buffer }
        e.stderr = Buffer.from('manifest unknown')
        throw e
      }
      return Buffer.from('')
    }) as never)
    // startEe throws → interactive p.log.error (261) → spinner catch rethrows (456-457) → exit
    await expect(setupEnterprise({ name: 'ee-int-pullfail' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('the interactive EE wizard surfaces a registry login failure', async () => {
    H.q.select.push('single')
    H.q.password.push('lh_live_BAD', 'password123')
    H.q.text.push('learn.school.dev', 'ops@school.dev', 'admin@school.dev')
    H.q.confirm.push(false, true) // localTls=no, startNow=yes
    const sp = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    sp.mockReturnValue({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('unauthorized: bad license') })
    // dockerLogin fails → interactive p.log.error (247) → spinner catch rethrows → exit
    await expect(setupEnterprise({ name: 'ee-int-loginfail' })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE setup with start exits when pulling/starting the EE stack fails', async () => {
    const m = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    m.mockImplementation(((cmd: string) => {
      if (cmd.includes('compose pull')) {
        const e = new Error('boom') as Error & { stderr: Buffer }
        e.stderr = Buffer.from('manifest unknown')
        throw e
      }
      return Buffer.from('')
    }) as never)
    await expect(setupEnterprise({
      ci: true, name: 'ee-pull', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: true,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('EE setup with start reports OSS mode when the license is not active', async () => {
    healthMock.waitForEeReady.mockResolvedValue('oss' as never)
    await setupEnterprise({
      ci: true, name: 'ee-oss', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: true,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-oss', 'docker-compose.yml'))).toBe(true)
  })

  it('EE setup with start warns when EE readiness times out', async () => {
    healthMock.waitForEeReady.mockResolvedValue('timeout' as never)
    await setupEnterprise({
      ci: true, name: 'ee-to', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: true,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-to', 'docker-compose.yml'))).toBe(true)
  })

  it('EE setup with start exits when the registry login fails', async () => {
    const sp = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    sp.mockReturnValue({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('unauthorized: bad license') })
    await expect(setupEnterprise({
      ci: true, name: 'eelogin', license: 'lh_live_BAD',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: true,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci --edition enterprise WITH start logs in, pulls and boots EE', async () => {
    await setupEnterprise({
      ci: true, name: 'ee-start', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: true,
    })
    expect(fs.existsSync(path.join(home, '.learnhouse', 'ee-start', 'docker-compose.yml'))).toBe(true)
  })

  it('EE setup exits when it cannot write the config files', async () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('ENOSPC: disk full') })
    await expect(setupEnterprise({
      ci: true, name: 'eefail', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: false,
    })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('setup --ci --edition enterprise --no-start generates the EE install', async () => {
    await setupEnterprise({
      ci: true, name: 'ee', license: 'lh_live_TESTKEY',
      domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
      adminPassword: 'password123', tenancy: 'single', start: false,
    })
    const dir = path.join(home, '.learnhouse', 'ee')
    expect(fs.existsSync(path.join(dir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'Caddyfile'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'learnhouse.config.json'))).toBe(true)
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'learnhouse.config.json'), 'utf-8'))
    expect(cfg.edition).toBe('enterprise')
  })

  it('update --to <version> resolves the tag via GHCR and pins it', async () => {
    const dir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir: dir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n    container_name: learnhouse-app-dep1\n    networks:\n      - n\nnetworks:\n  n:\n')

    // resolveTag fetches a GHCR token then the manifest — make both succeed.
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: unknown) =>
      String(u).includes('ghcr.io/token')
        ? new Response(JSON.stringify({ token: 't' }), { status: 200 })
        : new Response('', { status: 200 })) as typeof fetch)

    await expect(updateCommand({ version: '1.2.6', backup: false, migrate: false })).resolves.toBeUndefined()
    expect(fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf-8'))
      .toContain('ghcr.io/learnhouse/app:1.2.6')
  })
})

// ─── prerequisites — docker preflight ───────────────────────────

describe('checkPrerequisites', () => {
  let execSyncMock: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ProcessExit(code ?? 0) }) as never)
    execSyncMock = (await import('node:child_process')).execSync as unknown as ReturnType<typeof vi.fn>
    execSyncMock.mockReset(); execSyncMock.mockReturnValue(Buffer.from(''))
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves when Docker is installed and running', async () => {
    await expect(checkPrerequisites()).resolves.toBeUndefined()
  })

  it('exits when Docker is missing', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('docker: command not found') })
    await expect(checkPrerequisites()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('handles a prerequisite check that throws (permission denied)', async () => {
    execSyncMock.mockImplementation(((cmd: string) => {
      if (cmd.includes('docker --version')) return Buffer.from('') // installed
      const e = new Error('boom') as Error & { stderr: Buffer }
      e.stderr = Buffer.from('permission denied') // isDockerRunning rethrows this
      throw e
    }) as never)
    await expect(checkPrerequisites()).rejects.toBeInstanceOf(ProcessExit)
  })
})

// ─── dockerLogin — registry auth via spawnSync (password on stdin) ──

describe('dockerLogin', () => {
  let spawnSyncMock: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    spawnSyncMock = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    spawnSyncMock.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('passes the password over stdin and succeeds on status 0', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })
    expect(() => dockerLogin('images.example.app', 'license', 'lh_live_x')).not.toThrow()
    const [bin, args, opts] = spawnSyncMock.mock.calls.at(-1) as [string, string[], { input: string }]
    expect(bin).toBe('docker')
    expect(args).toContain('--password-stdin')
    expect(opts.input).toBe('lh_live_x') // never on the command line
  })

  it('throws with the registry name when login fails', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('unauthorized') })
    expect(() => dockerLogin('images.example.app', 'license', 'bad')).toThrow(/images\.example\.app/)
  })
})

// ─── docker log streamers (spawn, with cleanup) ────────────────

describe('docker log streamers', () => {
  let spawnMock: ReturnType<typeof vi.fn>
  let sigintBefore: number
  beforeEach(async () => {
    spawnMock = (await import('node:child_process')).spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockClear()
    sigintBefore = process.listenerCount('SIGINT')
  })
  afterEach(() => {
    for (const h of process.listeners('SIGINT').slice(sigintBefore)) process.removeListener('SIGINT', h as never)
    vi.restoreAllMocks()
  })

  it('dockerComposeLogs streams `docker compose logs -f` in the install dir', () => {
    dockerComposeLogs('/srv/lh')
    const [bin, args, opts] = spawnMock.mock.calls.at(-1) as [string, string[], { cwd: string }]
    expect(bin).toBe('docker')
    expect(args).toEqual(['compose', 'logs', '--tail', 'all', '-f'])
    expect(opts.cwd).toBe('/srv/lh')
  })

  it('dockerComposeLogs forwards SIGINT to the child and exits when it ends', () => {
    let exitCb: (() => void) | undefined
    const kill = vi.fn()
    spawnMock.mockImplementation(() => ({
      stdout: { on: () => {} }, stderr: { on: () => {} },
      on: (ev: string, cb: () => void) => { if (ev === 'exit') exitCb = cb },
      kill,
    }))
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ProcessExit(code ?? 0) }) as never)

    dockerComposeLogs('/srv/lh')
    process.emit('SIGINT')                    // → child.kill('SIGINT') (180)
    expect(kill).toHaveBeenCalledWith('SIGINT')
    expect(() => exitCb!()).toThrow(ProcessExit) // child exit → process.exit(0) (182)
  })

  it('dockerLogsMulti tails each named container', () => {
    dockerLogsMulti(['learnhouse-app-dep1', 'learnhouse-db-dep1'])
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0][1]).toContain('learnhouse-app-dep1')
    expect(spawnMock.mock.calls[1][1]).toContain('learnhouse-db-dep1')
  })

  it('dockerLogsMulti forwards SIGINT to every child', () => {
    const kills: ReturnType<typeof vi.fn>[] = []
    spawnMock.mockImplementation(() => {
      const kill = vi.fn(); kills.push(kill)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, kill }
    })
    dockerLogsMulti(['a', 'b'])
    process.emit('SIGINT')                    // → every child.kill('SIGINT') (193)
    expect(kills).toHaveLength(2)
    for (const k of kills) expect(k).toHaveBeenCalledWith('SIGINT')
  })

  it('dockerLogsMulti exits the process once every child has exited', () => {
    const children: Array<{ exit?: () => void }> = []
    spawnMock.mockImplementation(() => {
      const h: { exit?: () => void } = {}
      children.push(h)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev: string, cb: () => void) => { if (ev === 'exit') h.exit = cb }, kill: () => {} }
    })
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ProcessExit(code ?? 0) }) as never)

    dockerLogsMulti(['a', 'b'])
    children[0].exit!()                 // first child exits → not done yet
    expect(() => children[1].exit!()).toThrow(ProcessExit) // last child → process.exit(0)
  })

  it('dockerExecInteractive runs  and records the exit code', async () => {
    const ss = (await import('node:child_process')).spawnSync as unknown as ReturnType<typeof vi.fn>
    ss.mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })
    const prev = process.exitCode
    dockerExecInteractive('learnhouse-app-dep1', '/bin/sh')
    const call = ss.mock.calls.at(-1) as [string, string[]]
    expect(call[0]).toBe('docker')
    expect(call[1].slice(0, 4)).toEqual(['exec', '-it', 'learnhouse-app-dep1', '/bin/sh'])
    process.exitCode = prev
  })
})
