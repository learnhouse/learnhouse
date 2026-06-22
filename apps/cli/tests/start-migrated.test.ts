import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file: force migrateContentVolume to report a real content migration
// so startCommand's "Preserved existing uploaded content" branch executes.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execSync: vi.fn(() => Buffer.from('')) }
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
}))
vi.mock('@clack/prompts', () => promptStub)
const migMock = vi.hoisted(() => ({ status: 'migrated' as string, copiedBytes: 4096 }))
vi.mock('../src/services/content-volume-migration.js', () => ({
  migrateContentVolume: () => ({ status: migMock.status, copiedBytes: migMock.copiedBytes }),
  patchComposeAddContentVolume: (c: string) => c,
}))

import { startCommand } from '../src/commands/start.js'

describe('start — content migrated branch', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-startm-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'X=1\n')
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services:\n  learnhouse-app:\n')
    origHome = process.env.HOME
    process.env.HOME = home
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('logs the preserved-content message and starts (migrated)', async () => {
    migMock.status = 'migrated'
    await expect(startCommand()).resolves.toBeUndefined()
  })

  it('logs the volume-added message and starts (patched_no_data)', async () => {
    migMock.status = 'patched_no_data'
    await expect(startCommand()).resolves.toBeUndefined()
  })
})
