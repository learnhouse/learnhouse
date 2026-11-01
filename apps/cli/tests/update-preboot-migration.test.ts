import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `learnhouse update` must migrate the database with the NEW image before that
// image boots: the API's startup probes read columns only a migration adds, so
// booting first crash-loops and the post-start migration never runs. Old images
// cannot run alembic against the compose db at all (their env.py dials
// localhost), so the baseline comes from their `alembic heads` instead.
type Reply = string | Error | ((calls: string[]) => string | Error)
const calls = vi.hoisted(() => ({ list: [] as string[], responses: {} as Record<string, Reply>, spawned: [] as string[] }))
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const { routeExecFile } = await import('./exec-file-mock.js')
  return routeExecFile({
    ...actual,
    execSync: vi.fn((cmd: string) => {
      calls.list.push(cmd)
      for (const [needle, reply] of Object.entries(calls.responses)) {
        if (cmd.includes(needle)) {
          const res = typeof reply === 'function' ? reply(calls.list) : reply
          if (res instanceof Error) throw res
          return Buffer.from(res)
        }
      }
      return Buffer.from('')
    }),
    // `docker login` (EE update) pipes the license via spawnSync; never let it
    // reach a real daemon.
    spawnSync: vi.fn((file: string, args: string[] = []) => {
      calls.spawned.push([file, ...args].join(' '))
      return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }
    }),
  })
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
  confirm: async () => true,
}))
vi.mock('@clack/prompts', () => promptStub)
vi.mock('../src/services/content-volume-migration.js', () => ({
  migrateContentVolume: () => ({ status: 'already_mounted' }),
  patchComposeAddContentVolume: (c: string) => c,
}))
vi.mock('../src/services/health.js', () => ({
  waitForHealth: async () => true,
  waitForAppHealth: async () => true,
  waitForEeReady: async () => 'ee',
}))

import { updateCommand } from '../src/commands/update.js'

const OLD_IMAGE = 'ghcr.io/learnhouse/app:1.0.1'
const NEW_IMAGE = 'ghcr.io/learnhouse/app:1.6.0'
// execFileSync args joined with spaces (tests/exec-file-mock.ts): no shell quoting.
const RUN = 'docker compose run --rm --no-deps -T learnhouse-app sh -c cd /app/api && uv run alembic '
const EXEC = 'docker compose exec -T learnhouse-app sh -c cd /app/api && uv run alembic '

function quietConsole() {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('update: migrates with the new image before restarting', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    calls.list.length = 0
    calls.spawned.length = 0
    calls.responses = {}
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-updpb-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.0.1', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'),
      `name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ${OLD_IMAGE}\n`)
    origHome = process.env.HOME
    process.env.HOME = home
    // A no-version update resolves the newest release over the network
    // (GitHub releases + GHCR manifest); answer it locally.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response(JSON.stringify([{ tag_name: '1.6.0', draft: false, prerelease: false }]))
      }
      if (url.includes('ghcr.io/token')) return new Response(JSON.stringify({ token: 't' }))
      return new Response('{}', { status: 200 })
    }))
    quietConsole()
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const compose = () => fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')

  it('stamps an unstamped DB at the old image heads, upgrades, and only then restarts', async () => {
    // The old container can list its heads but not talk to the db; after the
    // restart the new container answers normally.
    calls.responses[EXEC + 'current'] = (list) =>
      list.includes('docker compose up -d') ? 'c7d8e9f0a1b2 (head)\n' : new Error('connection to server at "localhost" failed')
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = ''

    await expect(updateCommand({ backup: false, migrate: true })).resolves.toBeUndefined()

    const stamp = calls.list.indexOf(RUN + 'stamp r7s8t9u0v1w2')
    const upgrade = calls.list.indexOf(RUN + 'upgrade heads')
    const up = calls.list.indexOf('docker compose up -d')
    const pull = calls.list.indexOf('docker compose pull')
    // The old app must be stopped first or its connections block the DDL locks.
    const stopApp = calls.list.indexOf('docker compose stop learnhouse-app')
    expect(pull).toBeGreaterThanOrEqual(0)
    expect(stopApp).toBeGreaterThan(pull)
    expect(stamp).toBeGreaterThan(stopApp)
    expect(upgrade).toBeGreaterThan(stamp)
    // No `down` and no `--pull always`: `up -d` recreates only what changed,
    // from the image pulled above.
    expect(up).toBeGreaterThan(upgrade)
    expect(calls.list).not.toContain('docker compose down')
    expect(calls.list.some((c) => c.includes('--pull'))).toBe(false)
    expect(compose()).toContain(NEW_IMAGE)
  })

  it('does not stamp a database that already carries a revision', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = 'a1b2c3d4e5f6\n'

    await expect(updateCommand({ backup: false, migrate: true })).resolves.toBeUndefined()

    expect(calls.list.some((c) => c.startsWith(RUN + 'stamp'))).toBe(false)
    expect(calls.list).toContain(RUN + 'upgrade heads')
  })

  it('restarts the old version on its image when the pre-start migration fails', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = ''
    calls.responses[RUN + 'upgrade heads'] = new Error('Running upgrade r7s8t9u0v1w2 -> b1n2u3d4g5e6 failed')

    await expect(updateCommand({ backup: false, migrate: true })).rejects.toThrow('exit 1')

    expect(calls.list).not.toContain('docker compose down')
    expect(compose()).toContain(OLD_IMAGE)
    // The stopped old app is brought back on its own image.
    const stopApp = calls.list.indexOf('docker compose stop learnhouse-app')
    const restart = calls.list.lastIndexOf('docker compose up -d')
    expect(stopApp).toBeGreaterThanOrEqual(0)
    expect(restart).toBeGreaterThan(stopApp)
  })

  it('--no-migrate skips the pre-start migration as well', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'

    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()

    expect(calls.list.some((c) => c.startsWith(RUN))).toBe(false)
    expect(calls.list).not.toContain('docker compose stop learnhouse-app')
    expect(calls.list).toContain('docker compose up -d')
    expect(compose()).toContain(NEW_IMAGE)
  })

  it('restores docker-compose.yml when the image pull fails', async () => {
    calls.responses['docker compose pull'] = new Error('manifest unknown')

    await expect(updateCommand({ backup: false, migrate: true })).rejects.toThrow('exit 1')

    expect(compose()).toContain(OLD_IMAGE)
    expect(compose()).not.toContain(NEW_IMAGE)
    // Nothing was stopped or migrated: the running version is untouched.
    expect(calls.list).not.toContain('docker compose stop learnhouse-app')
    expect(calls.list.some((c) => c.startsWith(RUN))).toBe(false)
  })

  it('after a successful pre-start migration, a failed restart keeps the new image and retries the start', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = 'a1b2c3d4e5f6\n'
    calls.responses['docker compose up -d'] = new Error('port is already allocated')

    await expect(updateCommand({ backup: false, migrate: true })).rejects.toThrow('exit 1')

    // The schema is already migrated forward: going back to the old image would
    // boot it against a schema it does not know.
    expect(compose()).toContain(NEW_IMAGE)
    // The app was stopped for the migration, so the failure path tries to start it again.
    expect(calls.list.filter((c) => c === 'docker compose up -d').length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a --to tag that could inject YAML (newline)', async () => {
    await expect(updateCommand({ version: '1.6.0\n  evil: true', backup: false, migrate: true }))
      .rejects.toThrow('exit 1')

    expect(compose()).toContain(OLD_IMAGE)
    expect(compose()).not.toContain('evil')
    expect(calls.list).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('update (enterprise): migrates with the new image before restarting', () => {
  const EE_RUN = 'docker compose run --rm --no-deps -T api sh -c cd /app && uv run alembic '
  const EE_EXEC = 'docker compose exec -T api sh -c cd /app && uv run alembic '
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    calls.list.length = 0
    calls.spawned.length = 0
    calls.responses = {}
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-updpb-ee-'))
    installDir = path.join(home, '.learnhouse', 'ee')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.5.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080, edition: 'enterprise', eeTenancy: 'single',
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), "LEARNHOUSE_LICENSE_KEY='lic'\nEE_IMAGE_TAG='1.5.0'\n")
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'),
      'name: learnhouse-dep1\nservices:\n  db:\n    image: pg\n  api:\n    image: ee/api:${EE_IMAGE_TAG}\n')
    origHome = process.env.HOME
    process.env.HOME = home
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests') }))
    quietConsole()
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const env = () => fs.readFileSync(path.join(installDir, '.env'), 'utf-8')

  it('stops the api and migrates with the new image before `up`', async () => {
    calls.responses[EE_EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[EE_RUN + 'current'] = 'r7s8t9u0v1w2\n'

    await expect(updateCommand({ version: '1.6.0', backup: false, migrate: true })).resolves.toBeUndefined()

    const pull = calls.list.indexOf('docker compose pull')
    const logout = calls.list.indexOf('docker logout images.learnhouse.app')
    const stopApi = calls.list.indexOf('docker compose stop api')
    const upgrade = calls.list.indexOf(EE_RUN + 'upgrade heads')
    const up = calls.list.indexOf('docker compose up -d')
    expect(calls.spawned.some((c) => c.startsWith('docker login images.learnhouse.app'))).toBe(true)
    expect(pull).toBeGreaterThanOrEqual(0)
    // Registry credentials are dropped right after the pull.
    expect(logout).toBeGreaterThan(pull)
    expect(stopApi).toBeGreaterThan(pull)
    expect(upgrade).toBeGreaterThan(stopApi)
    expect(up).toBeGreaterThan(upgrade)
    expect(env()).toMatch(/^EE_IMAGE_TAG='?1\.6\.0'?$/m)
  })

  it('restarts the old tag when the pre-start migration fails', async () => {
    calls.responses[EE_EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[EE_RUN + 'current'] = 'r7s8t9u0v1w2\n'
    calls.responses[EE_RUN + 'upgrade heads'] = new Error('Running upgrade r7s8t9u0v1w2 -> b1n2u3d4g5e6 failed')

    await expect(updateCommand({ version: '1.6.0', backup: false, migrate: true })).rejects.toThrow('exit 1')

    // .env is back on the old tag before the stack is started again.
    expect(env()).toMatch(/^EE_IMAGE_TAG='?1\.5\.0'?$/m)
    const stopApi = calls.list.indexOf('docker compose stop api')
    const restart = calls.list.lastIndexOf('docker compose up -d')
    expect(stopApi).toBeGreaterThanOrEqual(0)
    expect(restart).toBeGreaterThan(stopApi)
    // The post-start verification never runs against the restored version.
    expect(calls.list).not.toContain(EE_EXEC + 'upgrade heads')
  })
})
