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
const calls = vi.hoisted(() => ({ list: [] as string[], responses: {} as Record<string, Reply> }))
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
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
  }
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
vi.mock('../src/services/health.js', () => ({ waitForHealth: async () => true }))

import { updateCommand } from '../src/commands/update.js'

const OLD_IMAGE = 'ghcr.io/learnhouse/app:1.0.1'
const RUN = 'docker compose run --rm --no-deps -T learnhouse-app sh -c "cd /app/api && uv run alembic '
const EXEC = 'docker compose exec -T learnhouse-app sh -c "cd /app/api && uv run alembic '

describe('update — migrates with the new image before restarting', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    calls.list.length = 0
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
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const compose = () => fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')

  it('stamps an unstamped DB at the old image heads, upgrades, and only then restarts', async () => {
    // The old container can list its heads but not talk to the db; after the
    // restart the new container answers normally.
    calls.responses[EXEC + 'current'] = (list) =>
      list.includes('docker compose down') ? 'c7d8e9f0a1b2 (head)\n' : new Error('connection to server at "localhost" failed')
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = ''

    await expect(updateCommand({ backup: false, migrate: true })).resolves.toBeUndefined()

    const stamp = calls.list.findIndex((c) => c.startsWith(RUN + 'stamp r7s8t9u0v1w2"'))
    const upgrade = calls.list.findIndex((c) => c.startsWith(RUN + 'upgrade heads"'))
    const down = calls.list.findIndex((c) => c === 'docker compose down')
    const pull = calls.list.findIndex((c) => c === 'docker compose pull')
    // The old app must be stopped first or its connections block the DDL locks.
    const stopApp = calls.list.findIndex((c) => c === 'docker compose stop learnhouse-app')
    expect(stopApp).toBeGreaterThan(pull)
    expect(stamp).toBeGreaterThan(stopApp)
    expect(upgrade).toBeGreaterThan(stamp)
    expect(down).toBeGreaterThan(upgrade)
    expect(compose()).not.toContain(OLD_IMAGE)
  })

  it('does not stamp a database that already carries a revision', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'
    calls.responses[RUN + 'current'] = 'a1b2c3d4e5f6\n'

    await expect(updateCommand({ backup: false, migrate: true })).resolves.toBeUndefined()

    expect(calls.list.some((c) => c.startsWith(RUN + 'stamp'))).toBe(false)
    expect(calls.list.some((c) => c.startsWith(RUN + 'upgrade heads"'))).toBe(true)
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
    expect(restart).toBeGreaterThan(stopApp)
  })

  it('--no-migrate skips the pre-start migration as well', async () => {
    calls.responses[EXEC + 'heads'] = 'r7s8t9u0v1w2 (head)\n'

    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()

    expect(calls.list.some((c) => c.startsWith(RUN))).toBe(false)
    expect(calls.list).not.toContain('docker compose stop learnhouse-app')
    expect(calls.list).toContain('docker compose down')
  })
})
