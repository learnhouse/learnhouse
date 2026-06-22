import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file: give the deployment a real (non-localhost) domain so doctor's
// DNS-resolution check runs, and mock node:dns so we can exercise both the
// "resolves" (pass) and "fails" (warn) branches deterministically/offline.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) {
        return Buffer.from('learnhouse-app-dep1\tUp 2 hours\tghcr.io/learnhouse/app:1.4.2\n')
      }
      if (typeof cmd === 'string' && cmd.includes('State.Running')) return Buffer.from('true')
      return Buffer.from('')
    }),
  }
})
const promptStub = vi.hoisted(() => ({
  log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
  intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
  spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
  isCancel: () => false,
}))
vi.mock('@clack/prompts', () => promptStub)
const dnsMock = vi.hoisted(() => ({ shouldResolve: true }))
vi.mock('node:dns', () => ({
  promises: {
    resolve: async (host: string) => {
      if (!dnsMock.shouldResolve) throw new Error(`ENOTFOUND ${host}`)
      return ['203.0.113.10']
    },
  },
}))

import { doctorCommand } from '../src/commands/doctor.js'

describe('doctor — DNS resolution check', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-dns-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'learn.example.com', httpPort: 443,
      useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=learn.example.com\n')
    origHome = process.env.HOME
    process.env.HOME = home
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error(`exit ${c}`) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('passes when the configured domain resolves', async () => {
    dnsMock.shouldResolve = true
    await expect(doctorCommand()).resolves.toBeUndefined()
  })

  it('warns when the configured domain fails to resolve', async () => {
    dnsMock.shouldResolve = false
    await expect(doctorCommand()).resolves.toBeUndefined()
  })
})
