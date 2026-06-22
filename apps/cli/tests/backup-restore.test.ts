import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Real tar runs (execSync is NOT mocked here — tar is a deterministic system
// tool, no daemon needed). Only the database exec calls are stubbed: the dump
// writer produces a real database.sql so the archive is genuine.
const promptStub = vi.hoisted(() => {
  const s = { selectValue: 'create' as string, textValue: '' as string, confirmValue: true }
  return {
    _s: s,
    log: { error: () => {}, info: () => {}, success: () => {}, warn: () => {}, warning: () => {}, message: () => {}, step: () => {} },
    intro: () => {}, outro: () => {}, cancel: () => {}, note: () => {},
    spinner: () => ({ start: () => {}, stop: () => {}, message: () => {} }),
    select: async () => s.selectValue,
    text: async () => s.textValue,
    confirm: async () => s.confirmValue,
    isCancel: () => false,
  }
})
vi.mock('@clack/prompts', () => promptStub)
vi.mock('../src/utils/prompt.js', () => promptStub)
const dockerMock = vi.hoisted(() => ({
  isContainerRunning: vi.fn(() => true),
  autoDetectDeploymentId: vi.fn(() => 'dep1'),
  dockerExecToFile: vi.fn(),
  dockerExecFromFile: vi.fn(),
}))
vi.mock('../src/services/docker.js', () => dockerMock)

import { backupCommand } from '../src/commands/backup.js'
import { restoreCommand } from '../src/commands/restore.js'

class ProcessExit extends Error {
  code: number
  constructor(code: number) { super(`process.exit(${code})`); this.code = code }
}

describe('backup / restore — real tar, stubbed database', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-'))
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
    dockerMock.isContainerRunning.mockReturnValue(true)
    dockerMock.autoDetectDeploymentId.mockReturnValue('dep1')
    dockerMock.dockerExecFromFile.mockReset().mockImplementation(() => {})
    dockerMock.dockerExecToFile.mockReset().mockImplementation((_c: string, _cmd: string, out: string) =>
      fs.writeFileSync(out, 'CREATE TABLE t (id int);\nDROP TABLE IF EXISTS t;\n'))
    promptStub._s.selectValue = 'create'; promptStub._s.textValue = ''; promptStub._s.confirmValue = true
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('backup creates a real .tar.gz containing the dump and .env', async () => {
    await backupCommand() // non-TTY → createBackup

    // Pin the exact pg_dump invocation: it MUST target the deployment's db
    // container and pass --clean --if-exists so the restore is idempotent.
    expect(dockerMock.dockerExecToFile).toHaveBeenCalledWith(
      'learnhouse-db-dep1',
      'pg_dump -U learnhouse --clean --if-exists learnhouse',
      expect.stringMatching(/database\.sql$/),
    )

    const backupsDir = path.join(installDir, 'backups')
    const archives = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz'))
    expect(archives).toHaveLength(1)

    // The temp working dir must have been cleaned up — only the archive remains.
    expect(fs.readdirSync(backupsDir).filter((e) => !e.endsWith('.tar.gz'))).toHaveLength(0)

    // Extract for real and verify contents.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-x-'))
    execSync(`tar -xzf "${path.join(backupsDir, archives[0])}" -C "${out}"`, { stdio: 'pipe' })
    const sub = fs.readdirSync(out)[0]
    expect(fs.readFileSync(path.join(out, sub, 'database.sql'), 'utf-8')).toContain('DROP TABLE IF EXISTS')
    expect(fs.existsSync(path.join(out, sub, '.env'))).toBe(true)
    fs.rmSync(out, { recursive: true, force: true })
  })

  it('restore extracts a real archive, runs psql, and cleans up', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)

    await expect(restoreCommand(archive)).resolves.toBeUndefined()
    // The .restore-tmp working dir must be cleaned up afterwards.
    expect(fs.existsSync(path.join(installDir, '.restore-tmp'))).toBe(false)
  })

  it('backup in interactive mode shows the menu and creates a backup', async () => {
    const orig = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      // promptStub.select returns 'create' → createBackup runs via the menu.
      await backupCommand()
      const backupsDir = path.join(installDir, 'backups')
      expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')).length).toBeGreaterThanOrEqual(1)
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: orig, configurable: true })
    }
  })

  it('backupCommand --restore exits when the db restore fails', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    dockerMock.dockerExecFromFile.mockImplementation(() => { throw new Error('psql restore failed') })
    await expect(backupCommand(archive, { restore: true })).rejects.toBeInstanceOf(ProcessExit)
  })

  it('backup exits when no installation config can be found', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bnc-home-'))
    const bareCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bnc-cwd-'))
    const origCwd = process.cwd()
    process.env.HOME = emptyHome
    process.chdir(bareCwd)
    try {
      await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit) // createBackup → config null → exit (20-21)
    } finally {
      process.chdir(origCwd)
      process.env.HOME = home
      fs.rmSync(emptyHome, { recursive: true, force: true })
      fs.rmSync(bareCwd, { recursive: true, force: true })
    }
  })

  it('restore exits when the backup file does not exist', async () => {
    const missing = path.join(home, 'nope-does-not-exist.tar.gz')
    await expect(backupCommand(missing, { restore: true })).rejects.toBeInstanceOf(ProcessExit) // 102-103
  })

  it('restore exits when no installation config can be found', async () => {
    const archive = path.join(home, 'real.tar.gz')
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-cfg-'))
    fs.mkdirSync(path.join(stage, 'b'))
    fs.writeFileSync(path.join(stage, 'b', 'database.sql'), 'SELECT 1;')
    execSync(`tar -czf "${archive}" -C "${stage}" b`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-cfg-home-'))
    const bareCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-cfg-cwd-'))
    const origCwd = process.cwd()
    process.env.HOME = emptyHome
    process.chdir(bareCwd)
    try {
      await expect(backupCommand(archive, { restore: true })).rejects.toBeInstanceOf(ProcessExit) // 110-111
    } finally {
      process.chdir(origCwd)
      process.env.HOME = home
      fs.rmSync(emptyHome, { recursive: true, force: true })
      fs.rmSync(bareCwd, { recursive: true, force: true })
    }
  })

  it('backupCommand --restore refuses an external database', async () => {
    await backupCommand() // make an archive while the config is still local
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: true, orgSlug: 'default',
    }))
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true }).catch((e) => e) // 115-117
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)                                  // hard failure, not a clean exit
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // guard fired BEFORE any restore
  })

  it('backupCommand --restore exits when the database container is not running', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    dockerMock.isContainerRunning.mockReturnValue(false) // restore guard → exit (122-123)
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // never attempts psql on a stopped db
  })

  it('backupCommand --restore cancels cleanly (exit 0) when the confirmation is declined', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    promptStub._s.confirmValue = false // decline the "are you sure" prompt → exit(0) (133-134)
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(0)                                  // user cancel is a CLEAN exit, not an error
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // declining must not touch the database
  })

  it('backupCommand --restore exits when the archive cannot be extracted', async () => {
    const junk = path.join(installDir, 'junk.tar.gz')
    fs.writeFileSync(junk, 'this is not a gzip tarball at all') // real tar -xzf fails
    await expect(backupCommand(junk, { restore: true })).rejects.toBeInstanceOf(ProcessExit) // 148-151
  })

  it('backupCommand --restore exits when the archive has no database.sql', async () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-nodbsql-'))
    fs.mkdirSync(path.join(stage, 'empty'))
    fs.writeFileSync(path.join(stage, 'empty', 'readme.txt'), 'no dump here')
    const bad = path.join(home, 'no-dump.tar.gz')
    execSync(`tar -czf "${bad}" -C "${stage}" empty`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })
    await expect(backupCommand(bad, { restore: true })).rejects.toBeInstanceOf(ProcessExit) // 161-163
  })

  it('backup interactive menu can route to restore', async () => {
    await backupCommand() // create an archive first
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    const orig = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    promptStub._s.selectValue = 'restore' // menu → restore
    promptStub._s.textValue = archive      // prompt for the archive path
    dockerMock.dockerExecFromFile.mockClear()
    try {
      await backupCommand()
      // Prove the menu actually ROUTED to restore (ran psql) rather than no-opping —
      // the previous version of this test had no assertion at all.
      expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith(
        'learnhouse-db-dep1', 'psql -U learnhouse -d learnhouse', expect.stringMatching(/database\.sql$/),
      )
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: orig, configurable: true })
    }
  })

  it('backupCommand --restore extracts and restores from an archive', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    dockerMock.dockerExecFromFile.mockClear()
    await expect(backupCommand(archive, { restore: true })).resolves.toBeUndefined()
    // Prove the restore ACTUALLY ran psql against the right container with the
    // extracted dump — not merely that the command returned without throwing.
    expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith(
      'learnhouse-db-dep1',
      'psql -U learnhouse -d learnhouse',
      expect.stringMatching(/database\.sql$/),
    )
  })

  it('backup exits and cleans up when the pg_dump fails', async () => {
    dockerMock.dockerExecToFile.mockImplementation(() => { throw new Error('pg_dump failed') })
    await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit)
    // The temp working dir must be removed even on failure.
    const backupsDir = path.join(installDir, 'backups')
    if (fs.existsSync(backupsDir)) {
      expect(fs.readdirSync(backupsDir).filter((e) => !e.endsWith('.tar.gz'))).toHaveLength(0)
    }
  })

  it('backup exits when the database container is not running', async () => {
    dockerMock.isContainerRunning.mockReturnValue(false)
    await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit)
  })

  it('restore exits when the archive cannot be extracted', async () => {
    const junk = path.join(installDir, 'junk.tar.gz')
    fs.writeFileSync(junk, 'this is not a gzip tarball at all') // real tar -xzf fails
    await expect(restoreCommand(junk)).rejects.toBeInstanceOf(ProcessExit)
    expect(fs.existsSync(path.join(installDir, '.restore-tmp'))).toBe(false) // cleaned up
  })

  it('restore exits when the database restore command fails', async () => {
    await backupCommand() // make a valid archive that extracts fine
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    dockerMock.dockerExecFromFile.mockImplementation(() => { throw new Error('psql restore failed') })
    await expect(restoreCommand(archive)).rejects.toBeInstanceOf(ProcessExit)
    expect(fs.existsSync(path.join(installDir, '.restore-tmp'))).toBe(false) // cleaned up
  })

  it('restore cancels when the user declines the confirmation', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    promptStub._s.confirmValue = false
    const orig = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      await expect(restoreCommand(archive)).rejects.toBeInstanceOf(ProcessExit) // confirm declined → exit(0)
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: orig, configurable: true })
    }
  })

  it('restore exits when the database container is not running', async () => {
    dockerMock.isContainerRunning.mockReturnValue(false)
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x')
    await expect(restoreCommand(dummy)).rejects.toBeInstanceOf(ProcessExit)
  })

  it('restore exits when the found config has no deployment id', async () => {
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-rnoid-'))
    fs.writeFileSync(path.join(cwdDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir: cwdDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(cwdDir, '.env'), 'X=1\n')
    const dummy = path.join(cwdDir, 'a.tar.gz')
    fs.writeFileSync(dummy, 'x')
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-rnoid-home-'))
    const origCwd = process.cwd()
    const origHome2 = process.env.HOME
    process.env.HOME = emptyHome
    process.chdir(cwdDir)
    dockerMock.autoDetectDeploymentId.mockReturnValue(null)
    try {
      await expect(restoreCommand(dummy)).rejects.toBeInstanceOf(ProcessExit) // id null → "No deployment found"
    } finally {
      process.chdir(origCwd)
      if (origHome2 === undefined) delete process.env.HOME; else process.env.HOME = origHome2
      fs.rmSync(cwdDir, { recursive: true, force: true })
      fs.rmSync(emptyHome, { recursive: true, force: true })
    }
  })

  it('restore exits when no deployment id can be resolved', async () => {
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    dockerMock.autoDetectDeploymentId.mockReturnValue(null)
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x')
    await expect(restoreCommand(dummy)).rejects.toBeInstanceOf(ProcessExit)
  })

  it('backup and restore refuse an external database', async () => {
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: true, orgSlug: 'default',
    }))
    await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit)
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x') // exists → restore reaches the external-db guard
    await expect(restoreCommand(dummy)).rejects.toBeInstanceOf(ProcessExit)
  })

  it('restore also restores the .env when the user confirms', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    // Change the live .env, then restore — the archived .env should come back.
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=changed\n')
    await backupCommand(archive, { restore: true })
    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8')).toContain('LEARNHOUSE_DOMAIN=localhost')
  })

  it('restore restores the .env in interactive mode when confirmed', async () => {
    await backupCommand()
    const backupsDir = path.join(installDir, 'backups')
    const archive = path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
    const orig = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=changed\n')
      await restoreCommand(archive) // confirm=true (stub) → restore + .env restore
      expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8')).toContain('LEARNHOUSE_DOMAIN=localhost')
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: orig, configurable: true })
    }
  })

  it('restore rejects an archive with no database.sql inside', async () => {
    // Build a tar.gz that contains a folder but no database.sql.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-bad-'))
    fs.mkdirSync(path.join(stage, 'empty'))
    fs.writeFileSync(path.join(stage, 'empty', 'readme.txt'), 'no dump here')
    const bad = path.join(home, 'bad.tar.gz')
    execSync(`tar -czf "${bad}" -C "${stage}" empty`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })

    await expect(restoreCommand(bad)).rejects.toBeInstanceOf(ProcessExit)
    expect(fs.existsSync(path.join(installDir, '.restore-tmp'))).toBe(false)
  })
})
