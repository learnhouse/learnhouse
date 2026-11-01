import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Isolated file: control migrateContentVolume's return status so updateCommand's
// content-migration switch executes the "migrated" and "no_compose" arms (the
// real helper needs a live daemon to ever report 'migrated').
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const { routeExecFile } = await import('./exec-file-mock.js')
  return routeExecFile({ ...actual, execSync: vi.fn(() => Buffer.from('')) })
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
  confirm: async () => true,
}))
vi.mock('@clack/prompts', () => promptStub)
const migMock = vi.hoisted(() => ({ status: 'migrated' as string, copiedBytes: 8192, throws: null as Error | null }))
vi.mock('../src/services/content-volume-migration.js', () => ({
  // The real helper calls `beforeCopy` right before copying, to stop the app.
  migrateContentVolume: (_dir: string, _id: string, beforeCopy?: () => void) => {
    if (migMock.status === 'migrated') beforeCopy?.()
    if (migMock.throws) throw migMock.throws
    return { status: migMock.status, copiedBytes: migMock.copiedBytes }
  },
  patchComposeAddContentVolume: (c: string) => c,
}))
vi.mock('../src/services/health.js', () => ({
  waitForHealth: async () => true,
  waitForAppHealth: async () => true,
}))

import { updateCommand } from '../src/commands/update.js'

const OLD_IMAGE = 'ghcr.io/learnhouse/app:1.4.0'

describe('update: content-migration status arms', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  const compose = () => fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf-8')
  const dockerCalls = () => vi.mocked(execSync).mock.calls.map((c) => String(c[0]))

  beforeEach(() => {
    migMock.status = 'migrated'
    migMock.throws = null
    vi.mocked(execSync).mockClear()
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-updm-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
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
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports the migrated byte count when content moves into the volume', async () => {
    migMock.status = 'migrated'
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
    // The app is stopped (not removed) before the copy, so nothing is uploaded
    // into the old container afterwards.
    const calls = dockerCalls()
    const stop = calls.indexOf('docker compose stop learnhouse-app')
    expect(stop).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('docker compose up -d')).toBeGreaterThan(stop)
    expect(calls).not.toContain('docker compose down')
    expect(compose()).toContain('ghcr.io/learnhouse/app:1.6.0')
  })

  it('notes a skipped migration when there is no docker-compose.yml', async () => {
    migMock.status = 'no_compose'
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
    expect(dockerCalls()).not.toContain('docker compose stop learnhouse-app')
  })

  it('aborts before touching the image when the content migration fails', async () => {
    migMock.throws = new Error('copy failed')
    await expect(updateCommand({ backup: false, migrate: false })).rejects.toThrow('exit 1')
    // Nothing was updated: compose keeps the old image, nothing was pulled, and
    // the (possibly stopped) app is brought back up.
    expect(compose()).toContain(OLD_IMAGE)
    const calls = dockerCalls()
    expect(calls).not.toContain('docker compose pull')
    expect(calls).toContain('docker compose up -d')
  })
})
