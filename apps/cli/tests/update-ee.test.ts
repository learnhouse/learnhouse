import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated file: unit-test the shared EE/Community upgrade helpers and the
// updateEnterprise command. docker.js + health.js are mocked so the alembic /
// login / pull / start steps are programmable; execSync handles the pg_dump
// backup (writing a real file so the size check passes).
const ctl = vi.hoisted(() => ({
  composeExec: '' as string | (() => string),
  loginThrows: false, pullThrows: false, upThrows: false, upRetryCb: false,
  eeReady: 'ee' as string,
}))
vi.mock('../src/services/docker.js', () => ({
  dockerComposeExec: (_cwd: string, _svc: string, _cmd: string) =>
    typeof ctl.composeExec === 'function' ? ctl.composeExec() : ctl.composeExec,
  dockerLogin: () => { if (ctl.loginThrows) { const e = new Error('denied') as Error & { stderr?: string }; e.stderr = 'unauthorized'; throw e } },
  dockerComposePull: () => { if (ctl.pullThrows) throw new Error('manifest unknown') },
  dockerComposeUpRetry: (_d: string, _n: number, cb: (n: number) => void) => {
    if (ctl.upRetryCb) cb(1)
    if (ctl.upThrows) throw new Error('compose up failed')
  },
}))
vi.mock('../src/services/health.js', () => ({ waitForEeReady: async () => ctl.eeReady }))

const cp = vi.hoisted(() => ({ cid: 'abc123', dumpBytes: 4096 }))
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (/date \+/.test(cmd)) return Buffer.from('20260101-000000')
    if (/compose ps -q/.test(cmd)) return Buffer.from(cp.cid)
    const redirect = String(cmd).match(/>\s*"([^"]+)"\s*$/) // capture the dump output path
    if (redirect) { fs.writeFileSync(redirect[1], Buffer.alloc(cp.dumpBytes)); return Buffer.from('') }
    return Buffer.from('')
  }),
}))

import {
  readEnvVar, setEnvVar, isExternalDbInstall, backupDatabase,
  ensureAlembicBaseline, runAlembicUpgrade, updateEnterprise,
} from '../src/commands/update-ee.js'

const LAYOUT = { appService: 'api', alembicCwd: '/app', dbService: 'db' }
const ui = { log: () => {}, ok: () => {}, warn: () => {} }

class ProcessExit extends Error { code: number; constructor(c: number) { super(`exit ${c}`); this.code = c } }

describe('update-ee shared upgrade helpers', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-uee-'))
    ctl.composeExec = ''; ctl.loginThrows = false; ctl.pullThrows = false
    ctl.upThrows = false; ctl.upRetryCb = false; ctl.eeReady = 'ee'
    cp.cid = 'abc123'; cp.dumpBytes = 4096
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ProcessExit(c ?? 0) }) as never)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })

  it('readEnvVar returns undefined when there is no .env', () => {
    expect(readEnvVar(dir, 'ANY')).toBeUndefined() // line 28
  })

  it('readEnvVar strips surrounding quotes', () => {
    fs.writeFileSync(path.join(dir, '.env'), "A='quoted'\nB=\"dq\"\nC=plain\n")
    expect(readEnvVar(dir, 'A')).toBe('quoted')
    expect(readEnvVar(dir, 'B')).toBe('dq')
    expect(readEnvVar(dir, 'C')).toBe('plain')
  })

  it('setEnvVar replaces an existing key and appends a new one', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'EE_IMAGE_TAG=prod\n')
    setEnvVar(dir, 'EE_IMAGE_TAG', 'v2') // replace branch (38)
    setEnvVar(dir, 'NEW_KEY', 'x')        // append branch (40)
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf-8')
    expect(env).toContain('EE_IMAGE_TAG=v2')
    expect(env).toContain('NEW_KEY=x')
  })

  it('backupDatabase dumps an in-container database', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    expect(isExternalDbInstall(dir)).toBe(false)
    const out = backupDatabase({ installDir: dir } as never, LAYOUT, ui)
    expect(out).toMatch(/db-pre-upgrade-.*\.sql\.gz$/)
    expect(fs.existsSync(out)).toBe(true)
  })

  it('backupDatabase dumps an external database via the app container network', () => {
    fs.writeFileSync(path.join(dir, '.env'),
      'LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://u:p@host:5432/lh\n')
    expect(isExternalDbInstall(dir)).toBe(true)
    const out = backupDatabase({ installDir: dir } as never, LAYOUT, ui) // 69-81
    expect(fs.existsSync(out)).toBe(true)
  })

  it('backupDatabase throws when the app container is not running (external)', () => {
    fs.writeFileSync(path.join(dir, '.env'),
      'LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://u:p@host:5432/lh\n')
    cp.cid = '' // compose ps -q returns nothing → not running (75)
    expect(() => backupDatabase({ installDir: dir } as never, LAYOUT, ui)).toThrow(/not running/)
  })

  it('backupDatabase throws when the produced dump looks empty', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    cp.dumpBytes = 10 // < 100 bytes → "looks empty" (90)
    expect(() => backupDatabase({ installDir: dir } as never, LAYOUT, ui)).toThrow(/looks empty/)
  })

  it('ensureAlembicBaseline reports a present baseline when already stamped', () => {
    ctl.composeExec = 'abc12345 (head)\n' // current → a revision present (112 → 118)
    fs.writeFileSync(path.join(dir, '.env'), 'X=1\n')
    expect(() => ensureAlembicBaseline(dir, LAYOUT, ui)).not.toThrow()
  })

  it('ensureAlembicBaseline stamps the baseline when the DB is unstamped', () => {
    ctl.composeExec = '' // current empty → not stamped → stamp heads (114-116)
    expect(() => ensureAlembicBaseline(dir, LAYOUT, ui)).not.toThrow()
  })

  it('ensureAlembicBaseline warns and continues when alembic errors', () => {
    ctl.composeExec = () => { throw new Error('container down') } // catch (121)
    expect(() => ensureAlembicBaseline(dir, LAYOUT, ui)).not.toThrow()
  })

  it('runAlembicUpgrade is a no-op when the DB is already at head', () => {
    ctl.composeExec = 'abc12345 (head)\n' // every current rev is a head (139-141)
    expect(runAlembicUpgrade(dir, LAYOUT, ui)).toBe(true)
  })

  it('runAlembicUpgrade applies migrations when the DB has a tracked revision', () => {
    let call = 0
    ctl.composeExec = () => {
      call++
      if (call === 1) return 'abc12345\n' // current: a revision, not a head
      return 'Running upgrade abc -> def\nRunning upgrade def -> ghi\n' // upgrade output (168-170)
    }
    expect(runAlembicUpgrade(dir, LAYOUT, ui)).toBe(true)
  })

  it('runAlembicUpgrade upgrades a fresh (unstamped) DB', () => {
    let call = 0
    ctl.composeExec = () => {
      call++
      if (call === 1) return '' // current: no revisions → create_all bootstrap (149)
      return 'Running upgrade base -> abc\n' // upgrade heads succeeds (151-154)
    }
    expect(runAlembicUpgrade(dir, LAYOUT, ui)).toBe(true)
  })

  it('runAlembicUpgrade stamps when create_all tables already exist', () => {
    let call = 0
    ctl.composeExec = () => {
      call++
      if (call === 1) return '' // no revisions
      if (call === 2) { const e = new Error('relation "x" already exists') as Error & { stderr: Buffer }; e.stderr = Buffer.from('already exists'); throw e } // 155-162
      return '' // stamp heads
    }
    expect(runAlembicUpgrade(dir, LAYOUT, ui)).toBe(true)
  })

  it('runAlembicUpgrade returns false on a genuine migration error', () => {
    let call = 0
    ctl.composeExec = () => {
      call++
      if (call === 1) return '' // no revisions
      const e = new Error('boom') as Error & { stderr: Buffer }; e.stderr = Buffer.from('syntax error'); throw e // not "already exists" → rethrow → outer catch (172-178)
    }
    expect(runAlembicUpgrade(dir, LAYOUT, ui)).toBe(false)
  })
})

describe('updateEnterprise command', () => {
  let home: string
  let dir: string
  let origHome: string | undefined
  const cfg = () => ({
    version: '1.4.0', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
    installDir: dir, domain: 'learn.school.dev', httpPort: 443,
    useHttps: true, autoSsl: true, useExternalDb: false, orgSlug: 'default',
    edition: 'enterprise', eeTenancy: 'single',
  }) as never

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-uec-'))
    dir = path.join(home, 'ee')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.env'),
      'EE_IMAGE_TAG=prod\nLEARNHOUSE_LICENSE_KEY=lh_live_TESTKEY\nLEARNHOUSE_DOMAIN=learn.school.dev\n')
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'name: learnhouse-dep1\nservices:\n  api:\n')
    origHome = process.env.HOME
    process.env.HOME = home
    ctl.composeExec = 'abc12345 (head)\n' // alembic already at head → migrations no-op
    ctl.loginThrows = false; ctl.pullThrows = false; ctl.upThrows = false; ctl.upRetryCb = false; ctl.eeReady = 'ee'
    cp.cid = 'abc123'; cp.dumpBytes = 4096
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ProcessExit(c ?? 0) }) as never)
  })
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('runs the full enterprise upgrade and applies migrations', async () => {
    await expect(updateEnterprise(cfg(), { interactive: false, backup: true, migrate: true })).resolves.toBeUndefined()
  })

  it('warns and continues when the API comes up in OSS mode', async () => {
    ctl.eeReady = 'oss' // 236
    await expect(updateEnterprise(cfg(), { interactive: false, backup: false, migrate: false })).resolves.toBeUndefined()
  })

  it('warns when EE readiness cannot be confirmed', async () => {
    ctl.eeReady = 'timeout' // 237
    await expect(updateEnterprise(cfg(), { interactive: false, backup: false, migrate: false })).resolves.toBeUndefined()
  })

  it('aborts when the registry login fails', async () => {
    ctl.loginThrows = true // 225
    await expect(updateEnterprise(cfg(), { interactive: true, backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('reverts the image tag and aborts when the pull fails', async () => {
    ctl.pullThrows = true // 229
    await expect(updateEnterprise(cfg(), { interactive: false, backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toContain('EE_IMAGE_TAG=prod') // tag reverted
  })

  it('surfaces the retry notice and aborts when the stack fails to start', async () => {
    ctl.upRetryCb = true; ctl.upThrows = true // 232-233
    await expect(updateEnterprise(cfg(), { interactive: true, backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when the post-upgrade migration fails', async () => {
    let call = 0
    ctl.composeExec = () => { // make runAlembicUpgrade fail
      call++
      if (call === 1) return '' // no revisions
      const e = new Error('boom') as Error & { stderr: Buffer }; e.stderr = Buffer.from('syntax error'); throw e
    }
    await expect(updateEnterprise(cfg(), { interactive: false, backup: false, migrate: true })).rejects.toBeInstanceOf(ProcessExit) // 240-242
  })

  it('aborts when the pre-upgrade backup fails', async () => {
    cp.dumpBytes = 5 // dump too small → backupDatabase throws → die (215)
    await expect(updateEnterprise(cfg(), { interactive: false, backup: true, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('exits when the license key is missing from .env', async () => {
    fs.writeFileSync(path.join(dir, '.env'), 'EE_IMAGE_TAG=prod\n') // no license (223)
    await expect(updateEnterprise(cfg(), { interactive: false, backup: false, migrate: false })).rejects.toBeInstanceOf(ProcessExit)
  })
})
