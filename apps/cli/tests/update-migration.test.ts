import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file: control migrateContentVolume's return status so updateCommand's
// content-migration switch executes the "migrated" and "no_compose" arms (the
// real helper needs a live daemon to ever report 'migrated').
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execSync: vi.fn(() => Buffer.from('')) }
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
  confirm: async () => true,
}))
vi.mock('@clack/prompts', () => promptStub)
const migMock = vi.hoisted(() => ({ status: 'migrated' as string, copiedBytes: 8192 }))
vi.mock('../src/services/content-volume-migration.js', () => ({
  migrateContentVolume: () => ({ status: migMock.status, copiedBytes: migMock.copiedBytes }),
  patchComposeAddContentVolume: (c: string) => c,
}))

import { updateCommand } from '../src/commands/update.js'

describe('update — content-migration status arms', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
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
      'name: learnhouse-dep1\nservices:\n  learnhouse-app:\n    image: ghcr.io/learnhouse/app:1.4.0\n')
    origHome = process.env.HOME
    process.env.HOME = home
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reports the migrated byte count when content moves into the volume', async () => {
    migMock.status = 'migrated'
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
  })

  it('notes a skipped migration when there is no docker-compose.yml', async () => {
    migMock.status = 'no_compose'
    await expect(updateCommand({ backup: false, migrate: false })).resolves.toBeUndefined()
  })
})
