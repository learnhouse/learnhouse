import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file so we can deterministically mock checkPort (→ port in use)
// without disturbing the real-socket promptDomain tests elsewhere.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execSync: vi.fn((cmd: string) =>
      cmd.includes('docker ps') ? Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
        : cmd.includes('State.Running') ? Buffer.from('true')
          : cmd.includes('RestartCount') ? Buffer.from('0')
            : cmd.includes('{{.Image}}') ? Buffer.from('sha256:abcdef0123456789')
              : Buffer.from('')),
  }
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
}))
vi.mock('@clack/prompts', () => promptStub)
vi.mock('../src/utils/network.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/network.js')>('../src/utils/network.js')
  return { ...actual, checkPort: vi.fn(async () => false) } // port reported as in use
})

import { doctorCommand } from '../src/commands/doctor.js'

describe('doctor — configured port in use', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-docp-'))
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
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('walks the port-in-use branch and completes', async () => {
    await expect(doctorCommand()).resolves.toBeUndefined()
  })
})
