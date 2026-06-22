import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file: mock execSync so the `tar -czf` archive step in createBackup
// throws, exercising the "Archive creation failed" path (which the real-tar
// suite can't reach without a genuinely broken filesystem).
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (String(cmd).includes('tar -czf')) throw new Error('disk full')
    return Buffer.from('')
  }),
}))
const dockerMock = vi.hoisted(() => ({
  isContainerRunning: vi.fn(() => true),
  autoDetectDeploymentId: vi.fn(() => 'dep1'),
  dockerExecToFile: vi.fn((_c: string, _cmd: string, out: string) => fs.writeFileSync(out, 'SELECT 1;')),
  dockerExecFromFile: vi.fn(),
}))
vi.mock('../src/services/docker.js', () => dockerMock)
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
  confirm: async () => true,
  select: async () => 'create',
  text: async () => '',
}))
vi.mock('@clack/prompts', () => promptStub)

import { backupCommand } from '../src/commands/backup.js'

class ProcessExit extends Error { code: number; constructor(c: number) { super(`exit ${c}`); this.code = c } }

describe('backup — archive creation failure', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-baf-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    origHome = process.env.HOME
    process.env.HOME = home
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ProcessExit(c ?? 0) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('exits when the tar archive step fails', async () => {
    await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit) // dump ok, archive fails → exit(1)
  })
})
