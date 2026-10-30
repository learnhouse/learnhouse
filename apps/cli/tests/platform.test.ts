import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FAKE_DOCKER, isWindows, itPosix } from './platform.js'

// Cross-platform behavior, run unmocked on every OS in CI (Linux, macOS,
// Windows). Docker is the fake from tests/fixtures (LEARNHOUSE_DOCKER_BIN), so
// process spawning, stdin/stdout file plumbing, tar and path handling are the
// real ones of the host OS.

const promptStub = vi.hoisted(() => {
  const noop = () => {}
  return {
    log: { error: noop, info: noop, success: noop, warn: noop, warning: noop, message: noop, step: noop },
    intro: noop, outro: noop, cancel: noop, note: noop,
    spinner: () => ({ start: noop, stop: noop, message: noop }),
    isCancel: () => false,
    confirm: async () => true,
    select: async () => 'create',
    text: async () => '',
    password: async () => '',
  }
})
vi.mock('@clack/prompts', () => promptStub)
vi.mock('../src/utils/prompt.js', () => promptStub)

import { dockerInvocation } from '../src/services/docker-bin.js'
import {
  composeServiceContainer,
  dockerComposeWorks,
  dockerExecFromFile,
  dockerExecToFile,
  isDockerInstalled,
  isDockerRunning,
  isTcpPortListening,
} from '../src/services/docker.js'
import { checkPort } from '../src/utils/network.js'
import { validateInstallName } from '../src/utils/validators.js'
import { writeFileAtomic } from '../src/utils/fs-atomic.js'
import { findInstallDir, readConfig } from '../src/services/config-store.js'
import { backupCommand } from '../src/commands/backup.js'
import { restoreCommand } from '../src/commands/restore.js'
import { setupEnterprise } from '../src/commands/setup-ee.js'

class ProcessExit extends Error { code: number; constructor(c: number) { super(`exit ${c}`); this.code = c } }

const ENV_KEYS = [
  'LEARNHOUSE_DOCKER_BIN', 'FAKE_DOCKER_DOWN', 'FAKE_DOCKER_EXEC', 'FAKE_DOCKER_EXEC_STDOUT',
  'FAKE_DOCKER_STDIN_TO', 'FAKE_DOCKER_EXEC_STATUS', 'FAKE_DOCKER_PS_ID', 'FAKE_DOCKER_LOG',
  'HOME', 'LEARNHOUSE_DIR', 'PATH',
]
let saved: Record<string, string | undefined>
let tmp: string

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-platform-'))
  process.env.LEARNHOUSE_DOCKER_BIN = FAKE_DOCKER
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('docker binary resolution', () => {
  it('defaults to docker on PATH', () => {
    delete process.env.LEARNHOUSE_DOCKER_BIN
    expect(dockerInvocation(['ps'])).toEqual(['docker', ['ps']])
  })
  it('LEARNHOUSE_DOCKER_BIN selects another docker-compatible CLI', () => {
    process.env.LEARNHOUSE_DOCKER_BIN = 'podman'
    expect(dockerInvocation(['ps'])).toEqual(['podman', ['ps']])
  })
  it('a .mjs override runs with the current Node (scripts cannot be exec\'d on Windows)', () => {
    expect(dockerInvocation(['ps'])).toEqual([process.execPath, [FAKE_DOCKER, 'ps']])
  })
})

describe('docker probes (real process spawning on this OS)', () => {
  it('installed, running, compose v2', () => {
    expect(isDockerInstalled()).toBe(true)
    expect(isDockerRunning()).toBe(true)
    expect(dockerComposeWorks()).toBe(true)
  })
  it('daemon down', () => {
    process.env.FAKE_DOCKER_DOWN = '1'
    expect(isDockerRunning()).toBe(false)
  })
  it('docker missing altogether', () => {
    process.env.LEARNHOUSE_DOCKER_BIN = path.join(tmp, 'no-such-docker')
    expect(isDockerInstalled()).toBe(false)
    expect(isDockerRunning()).toBe(false)
    expect(dockerComposeWorks()).toBe(false)
  })
  it('composeServiceContainer reads the id compose reports', () => {
    process.env.FAKE_DOCKER_PS_ID = 'abc123'
    expect(composeServiceContainer(tmp, 'db')).toBe('abc123')
    delete process.env.FAKE_DOCKER_PS_ID
    expect(composeServiceContainer(tmp, 'db')).toBe('')
  })
})

describe('docker exec stream plumbing (no shell, real file descriptors)', () => {
  beforeEach(() => { process.env.FAKE_DOCKER_EXEC = '1' })

  it('streams stdout into a file, byte for byte, at a path with spaces and non-ASCII', () => {
    const dir = path.join(tmp, 'dir with spaces é')
    fs.mkdirSync(dir)
    const out = path.join(dir, 'dump.sql')
    const payload = 'SELECT 1;\n-- ünïcødé, "quotes", $VARS and `ticks`\n'
    process.env.FAKE_DOCKER_EXEC_STDOUT = payload
    dockerExecToFile('db', ['sh', '-c', 'pg_dump "$X"'], out)
    expect(fs.readFileSync(out, 'utf-8')).toBe(payload)
  })

  it('feeds a file as stdin', () => {
    const input = path.join(tmp, 'in put.sql')
    fs.writeFileSync(input, 'CREATE TABLE t();\n')
    const sink = path.join(tmp, 'stdin.txt')
    process.env.FAKE_DOCKER_STDIN_TO = sink
    dockerExecFromFile('db', ['psql', '-f', '-'], input)
    expect(fs.readFileSync(sink, 'utf-8')).toBe('--- db psql -f -\nCREATE TABLE t();\n\n')
  })

  it('a non-zero exit throws with the stderr text; an allowed status does not', () => {
    process.env.FAKE_DOCKER_EXEC_STATUS = '1'
    const out = path.join(tmp, 'x')
    expect(() => dockerExecToFile('app', ['tar', '-cf', '-', '.'], out)).toThrow(/exited with 1/)
    try { dockerExecToFile('app', ['tar'], out) } catch (err) {
      expect(String((err as { stderr?: Buffer }).stderr)).toContain('fake exec failure')
    }
    expect(() => dockerExecToFile('app', ['tar', '-cf', '-', '.'], out, [0, 1])).not.toThrow()
  })
})

describe('backup → restore end to end (real tar on this OS, fake docker)', () => {
  it('round-trips the dump, .env and uploaded content from an install path with spaces', async () => {
    const home = path.join(tmp, 'home dir ñ')
    const installDir = path.join(home, '.learnhouse', 'my install')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.6.0', deploymentId: 'ab12cd34', createdAt: '2026-01-01T00:00:00Z', installDir,
      domain: 'localhost', httpPort: 8080, useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'),
      'name: learnhouse-ab12cd34\nservices:\n  learnhouse-app:\n    image: x\n  db:\n    image: y\n')
    process.env.HOME = home
    process.env.LEARNHOUSE_DIR = installDir
    process.env.FAKE_DOCKER_EXEC = '1'
    process.env.FAKE_DOCKER_PS_ID = 'cid'
    process.env.FAKE_DOCKER_EXEC_STDOUT = 'DUMP-OR-CONTENT-BYTES\n'
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ProcessExit(c ?? 0) }) as never)
    const tty = { in: process.stdin.isTTY, out: process.stdout.isTTY }
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    try {
      await backupCommand()
      const backups = path.join(installDir, 'backups')
      const archives = fs.readdirSync(backups).filter((f) => f.endsWith('.tar.gz'))
      expect(archives).toHaveLength(1)
      expect(fs.readdirSync(backups)).toHaveLength(1) // staging folder removed

      const sink = path.join(tmp, 'restored.txt')
      process.env.FAKE_DOCKER_STDIN_TO = sink
      await restoreCommand(path.join(backups, archives[0]), { yes: true })
      const fed = fs.readFileSync(sink, 'utf-8')
      // the dump went to psql in one transaction, the content to tar -x in the app
      expect(fed).toMatch(/--- cid sh -c .*ON_ERROR_STOP=1.*--single-transaction[^\n]*\nDUMP-OR-CONTENT-BYTES\n/)
      expect(fed).toMatch(/--- cid tar -C \/app\/api\/content -xf -\nDUMP-OR-CONTENT-BYTES\n/)
      expect(fs.readdirSync(installDir).some((e) => e.startsWith('.restore-'))).toBe(false)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: tty.in, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: tty.out, configurable: true })
    }
  })
})

describe('port probing', () => {
  it('EACCES (non-root, port < 1024) is not "in use"', async () => {
    vi.spyOn(net, 'createServer').mockImplementation((() => {
      const handlers: Record<string, (e?: unknown) => void> = {}
      return {
        once: (ev: string, fn: (e?: unknown) => void) => { handlers[ev] = fn },
        listen: () => handlers.error?.(Object.assign(new Error('denied'), { code: 'EACCES' })),
        close: (cb: () => void) => cb(),
      }
    }) as never)
    process.env.PATH = '' // no lsof/ss: nothing reports a listener
    expect(await checkPort(80)).toBe(true)
  })

  it('a port held by another process on 0.0.0.0 is in use', async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '0.0.0.0', r))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      expect(await checkPort(port)).toBe(false)
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })

  it('without lsof or ss (e.g. Windows), isTcpPortListening says no rather than throwing', () => {
    process.env.PATH = tmp
    expect(isTcpPortListening(65000)).toBe(false)
  })
})

describe('paths and names', () => {
  it.each(['CON', 'prn', 'aux', 'NUL', 'com1', 'LPT9', 'con.txt', 'name.', 'name '])(
    'rejects %j, which Windows cannot create as a directory', (name) => {
      expect(validateInstallName(name)).toBeDefined()
    })

  it('LEARNHOUSE_DIR is resolved to an absolute path on this OS', () => {
    process.env.LEARNHOUSE_DIR = path.join('relative', 'install')
    expect(path.isAbsolute(findInstallDir())).toBe(true)
  })

  it('readConfig reports the native absolute path of the install', () => {
    const dir = path.join(tmp, 'a b', 'c')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'learnhouse.config.json'), JSON.stringify({ deploymentId: 'ab12cd34', installDir: '/elsewhere' }))
    expect(readConfig(dir)!.installDir).toBe(path.resolve(dir))
  })

  it('writeFileAtomic replaces an existing file (rename over a file works on Windows too)', () => {
    const f = path.join(tmp, '.env')
    fs.writeFileSync(f, 'old')
    writeFileAtomic(f, 'new')
    writeFileAtomic(f, 'newer')
    expect(fs.readFileSync(f, 'utf-8')).toBe('newer')
    expect(fs.readdirSync(tmp)).toEqual(['.env'])
  })
})

describe('Enterprise setup outside Linux', () => {
  it.each(['darwin', 'win32'])('on %s without Docker, points to Docker Desktop and never runs get.docker.com', async (platform) => {
    process.env.LEARNHOUSE_DOCKER_BIN = path.join(tmp, 'no-such-docker')
    process.env.FAKE_DOCKER_LOG = path.join(tmp, 'docker.log')
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => { errors.push(String(m)) })
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ProcessExit(c ?? 0) }) as never)
    try {
      await expect(setupEnterprise({
        ci: true, license: 'lic', domain: 'learn.school.dev', adminEmail: 'admin@school.dev',
        adminPassword: 'password123', installDir: path.join(tmp, 'ee'), start: false,
      })).rejects.toMatchObject({ code: 1 })
    } finally {
      Object.defineProperty(process, 'platform', { value: real, configurable: true })
    }
    expect(errors.join('\n')).toContain('Docker Desktop')
    expect(fs.existsSync(path.join(tmp, 'ee', '.env'))).toBe(false)
  })
})

describe('POSIX-only guarantees', () => {
  itPosix('secret files are created owner-only (0600) without a world-readable window', () => {
    const f = path.join(tmp, 'secret')
    writeFileAtomic(f, 'x', 0o600)
    expect(fs.statSync(f).mode & 0o777).toBe(0o600)
  })

  it('platform helper reports the host correctly', () => {
    expect(isWindows).toBe(process.platform === 'win32')
  })
})
