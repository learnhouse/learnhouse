import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execSync } from 'node:child_process'

// Real tar runs (child_process is NOT mocked here; tar is a deterministic
// system tool, no daemon needed). Only the docker helpers are stubbed: the
// dump writer produces a real database.sql so the archive is genuine, and
// composeServiceContainer reports `cid-<service>` for every running service.
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
import { expectMode } from './platform.js'
vi.mock('@clack/prompts', () => promptStub)
vi.mock('../src/utils/prompt.js', () => promptStub)
const dockerMock = vi.hoisted(() => ({
  composeServiceContainer: vi.fn((_dir: string, svc: string) => `cid-${svc}`),
  isDeploymentRunning: vi.fn(() => true),
  dockerComposeStop: vi.fn(),
  dockerComposeUp: vi.fn(),
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

const DUMP_SQL = 'CREATE TABLE t (id int);\nDROP TABLE IF EXISTS t;\n'
const PG_DUMP = 'pg_dump -U "${POSTGRES_USER:-learnhouse}" --clean --if-exists "${POSTGRES_DB:-learnhouse}"'

/** Restore (and backup's interactive menu) need BOTH stdin and stdout to be terminals. */
function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}

describe('backup / restore: real tar, stubbed database', () => {
  let home: string
  let installDir: string
  let origHome: string | undefined
  let origStdinTTY: boolean | undefined
  let origStdoutTTY: boolean | undefined
  // SQL text each psql restore was fed (read at call time, before cleanup).
  let restoredSql: string[]

  const writeConfig = (extra: Record<string, unknown> = {}) =>
    fs.writeFileSync(path.join(installDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', deploymentId: 'dep1', createdAt: '2026-01-01T00:00:00Z',
      installDir, domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
      ...extra,
    }))
  const latestArchive = () => {
    const backupsDir = path.join(installDir, 'backups')
    return path.join(backupsDir, fs.readdirSync(backupsDir).find((f) => f.endsWith('.tar.gz'))!)
  }
  /** `.restore-XXXXXX` work dirs left in the install dir. */
  const restoreDirs = (dir = installDir) => fs.readdirSync(dir).filter((e) => e.startsWith('.restore-'))
  const psqlCalls = () => dockerMock.dockerExecFromFile.mock.calls.filter((c) => c[1][0] === 'sh')

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-'))
    installDir = path.join(home, '.learnhouse', 'test')
    fs.mkdirSync(installDir, { recursive: true })
    writeConfig()
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=localhost\n')
    origHome = process.env.HOME
    process.env.HOME = home
    origStdinTTY = process.stdin.isTTY
    origStdoutTTY = process.stdout.isTTY
    setTTY(false) // deterministic: non-interactive unless a test opts in
    restoredSql = []
    dockerMock.composeServiceContainer.mockReset().mockImplementation((_dir: string, svc: string) => `cid-${svc}`)
    dockerMock.isDeploymentRunning.mockReset().mockReturnValue(true)
    dockerMock.dockerComposeStop.mockReset()
    dockerMock.dockerComposeUp.mockReset()
    dockerMock.dockerExecFromFile.mockReset().mockImplementation((_c: string, cmd: string[], inPath: string) => {
      if (cmd[0] === 'sh') restoredSql.push(fs.readFileSync(inPath, 'utf-8'))
    })
    dockerMock.dockerExecToFile.mockReset().mockImplementation((_c: string, cmd: string[], out: string) =>
      fs.writeFileSync(out, cmd[0] === 'tar' ? 'content-tar-bytes' : DUMP_SQL))
    promptStub._s.selectValue = 'create'; promptStub._s.textValue = ''; promptStub._s.confirmValue = true
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0)
    }) as never)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: origStdinTTY, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutTTY, configurable: true })
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    fs.rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('backup creates a real .tar.gz containing the dump and .env', async () => {
    await backupCommand() // non-TTY → createBackup

    // The db container is resolved through the install's compose project, and
    // pg_dump MUST pass --clean --if-exists so the restore is idempotent.
    expect(dockerMock.composeServiceContainer).toHaveBeenCalledWith(installDir, 'db')
    expect(dockerMock.dockerExecToFile).toHaveBeenCalledWith(
      'cid-db',
      ['sh', '-c', PG_DUMP],
      expect.stringMatching(/database\.sql$/),
    )

    const backupsDir = path.join(installDir, 'backups')
    const archives = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz'))
    expect(archives).toHaveLength(1)

    // The staging dir must have been cleaned up; only the archive remains.
    expect(fs.readdirSync(backupsDir).filter((e) => !e.endsWith('.tar.gz'))).toHaveLength(0)

    // The archive holds the database and .env: owner-only.
    expectMode(backupsDir, 0o700)
    expectMode(path.join(backupsDir, archives[0]), 0o600)

    // Extract for real and verify contents.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-x-'))
    execSync(`tar -xzf "${path.join(backupsDir, archives[0])}" -C "${out}"`, { stdio: 'pipe' })
    const sub = fs.readdirSync(out)[0]
    expect(fs.readFileSync(path.join(out, sub, 'database.sql'), 'utf-8')).toContain('DROP TABLE IF EXISTS')
    expect(fs.existsSync(path.join(out, sub, '.env'))).toBe(true)
    const meta = JSON.parse(fs.readFileSync(path.join(out, sub, 'backup.json'), 'utf-8'))
    expect(meta).toMatchObject({ deploymentId: 'dep1', edition: 'community' })
    fs.rmSync(out, { recursive: true, force: true })
  })

  it('backup includes content.tar when the app container is running', async () => {
    await backupCommand()

    expect(dockerMock.composeServiceContainer).toHaveBeenCalledWith(installDir, 'learnhouse-app')
    expect(dockerMock.dockerExecToFile).toHaveBeenCalledWith(
      'cid-learnhouse-app',
      ['tar', '-C', '/app/api/content', '-cf', '-', '.'],
      expect.stringMatching(/content\.tar$/),
      [0, 1], // GNU tar exits 1 when a file changed while it was read; still a complete archive
    )
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-x-'))
    execSync(`tar -xzf "${latestArchive()}" -C "${out}"`, { stdio: 'pipe' })
    const sub = fs.readdirSync(out)[0]
    expect(fs.readFileSync(path.join(out, sub, 'content.tar'), 'utf-8')).toBe('content-tar-bytes')
    expect(JSON.parse(fs.readFileSync(path.join(out, sub, 'backup.json'), 'utf-8')).content).toBe(true)
    fs.rmSync(out, { recursive: true, force: true })
  })

  it('backup warns but still succeeds when the app container is not running', async () => {
    dockerMock.composeServiceContainer.mockImplementation((_dir: string, svc: string) =>
      svc === 'learnhouse-app' ? '' : `cid-${svc}`)
    const warn = vi.spyOn(promptStub.log, 'warn')

    await expect(backupCommand()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uploaded content is NOT in this backup'))
    expect(dockerMock.dockerExecToFile).toHaveBeenCalledTimes(1) // the dump only, no content tar
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-x-'))
    execSync(`tar -xzf "${latestArchive()}" -C "${out}"`, { stdio: 'pipe' })
    const sub = fs.readdirSync(out)[0]
    expect(fs.existsSync(path.join(out, sub, 'database.sql'))).toBe(true)
    expect(fs.existsSync(path.join(out, sub, 'content.tar'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(out, sub, 'backup.json'), 'utf-8')).content).toBe(false)
    fs.rmSync(out, { recursive: true, force: true })
  })

  it('backup <archive> without --restore exits 1 and touches nothing', async () => {
    const error = vi.spyOn(promptStub.log, 'error')
    const err = await backupCommand(path.join(home, 'some-backup.tar.gz')).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('learnhouse restore'))
    expect(dockerMock.composeServiceContainer).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecToFile).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(installDir, 'backups'))).toBe(false)
  })

  it('backup still runs when backups/ belongs to another user', async () => {
    const backupsDir = path.join(installDir, 'backups')
    const realChmod = fs.chmodSync
    vi.spyOn(fs, 'chmodSync').mockImplementation(((target: fs.PathLike, mode: fs.Mode) => {
      if (String(target) === backupsDir) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      }
      return realChmod(target, mode)
    }) as typeof fs.chmodSync)
    const warn = vi.spyOn(promptStub.log, 'warn')

    await backupCommand()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EPERM'))
    const archives = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz'))
    expect(archives).toHaveLength(1)
    expectMode(path.join(backupsDir, archives[0]), 0o600)
  })

  it('restore extracts a real archive, runs psql, and cleans up', async () => {
    await backupCommand()
    const archive = latestArchive()

    await expect(restoreCommand(archive, { yes: true })).resolves.toBeUndefined()
    // The extracted dump (not the archive) was fed to psql.
    expect(restoredSql).toEqual([DUMP_SQL])
    // The per-run .restore-XXXXXX working dir must be cleaned up afterwards.
    expect(restoreDirs()).toEqual([])
  })

  it('non-TTY restore without --yes exits 1 and never touches the database; with --yes it proceeds', async () => {
    await backupCommand()
    const archive = latestArchive()
    const error = vi.spyOn(promptStub.log, 'error')
    const confirm = vi.spyOn(promptStub, 'confirm')

    const err = await restoreCommand(archive).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1) // no silent auto-confirm in scripts/CI
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--yes'))
    expect(confirm).not.toHaveBeenCalled()
    expect(dockerMock.dockerComposeStop).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
    expect(restoreDirs()).toEqual([]) // nothing was even extracted

    await expect(restoreCommand(archive, { yes: true })).resolves.toBeUndefined()
    expect(confirm).not.toHaveBeenCalled() // --yes skips the prompt
    expect(restoredSql).toEqual([DUMP_SQL])
  })

  it('backup in interactive mode shows the menu and creates a backup', async () => {
    setTTY(true)
    const select = vi.spyOn(promptStub, 'select')
    // promptStub.select returns 'create' → createBackup runs via the menu.
    await backupCommand()
    expect(select).toHaveBeenCalled()
    const backupsDir = path.join(installDir, 'backups')
    expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz')).length).toBeGreaterThanOrEqual(1)
  })

  it('backupCommand --restore exits when the db restore fails', async () => {
    await backupCommand()
    const archive = latestArchive()
    dockerMock.dockerExecFromFile.mockImplementation(() => { throw new Error('psql restore failed') })
    const err = await backupCommand(archive, { restore: true, yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
  })

  it('restore failure reports a rollback, exits 1 and restarts the stopped app', async () => {
    await backupCommand()
    const archive = latestArchive()
    dockerMock.dockerExecFromFile.mockImplementation(() => {
      throw Object.assign(new Error('docker exec sh exited with 3'), { stderr: Buffer.from('ERROR: syntax error at line 1') })
    })
    const error = vi.spyOn(promptStub.log, 'error')
    const success = vi.spyOn(promptStub.log, 'success')

    const err = await restoreCommand(archive, { yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    const msg = error.mock.calls.map((c) => String(c[0])).join('\n')
    expect(msg).toContain('rolled back')
    expect(msg).toContain('syntax error at line 1') // psql's stderr is surfaced
    expect(success).not.toHaveBeenCalled()
    expect(dockerMock.dockerComposeStop).toHaveBeenCalledWith(installDir, 'learnhouse-app')
    expect(dockerMock.dockerComposeUp).toHaveBeenCalledWith(installDir) // not left stopped
    expect(restoreDirs()).toEqual([])
  })

  it('backup exits when no installation config can be found', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bnc-home-'))
    const bareCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bnc-cwd-'))
    const origCwd = process.cwd()
    process.env.HOME = emptyHome
    process.chdir(bareCwd)
    try {
      await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit) // createBackup → config null → exit
    } finally {
      process.chdir(origCwd)
      process.env.HOME = home
      fs.rmSync(emptyHome, { recursive: true, force: true })
      fs.rmSync(bareCwd, { recursive: true, force: true })
    }
  })

  it('restore exits when the backup file does not exist', async () => {
    const missing = path.join(home, 'nope-does-not-exist.tar.gz')
    await expect(backupCommand(missing, { restore: true })).rejects.toBeInstanceOf(ProcessExit)
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
      await expect(backupCommand(archive, { restore: true, yes: true })).rejects.toBeInstanceOf(ProcessExit)
      expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
    } finally {
      process.chdir(origCwd)
      process.env.HOME = home
      fs.rmSync(emptyHome, { recursive: true, force: true })
      fs.rmSync(bareCwd, { recursive: true, force: true })
    }
  })

  it('backupCommand --restore refuses an external database', async () => {
    await backupCommand() // make an archive while the config is still local
    const archive = latestArchive()
    writeConfig({ useExternalDb: true })
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true, yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)                                  // hard failure, not a clean exit
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // guard fired BEFORE any restore
  })

  it('backupCommand --restore exits when the database container is not running', async () => {
    await backupCommand()
    const archive = latestArchive()
    dockerMock.composeServiceContainer.mockImplementation((_dir: string, svc: string) => svc === 'db' ? '' : `cid-${svc}`)
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true, yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // never attempts psql on a stopped db
    expect(dockerMock.dockerComposeStop).not.toHaveBeenCalled()
  })

  it('backupCommand --restore cancels cleanly (exit 0) when the confirmation is declined', async () => {
    await backupCommand()
    const archive = latestArchive()
    setTTY(true)
    promptStub._s.confirmValue = false // decline the "are you sure" prompt → exit(0)
    dockerMock.dockerExecFromFile.mockClear()
    const err = await backupCommand(archive, { restore: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(0)                                  // user cancel is a CLEAN exit, not an error
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled() // declining must not touch the database
    expect(dockerMock.dockerComposeStop).not.toHaveBeenCalled()
  })

  it('backupCommand --restore without an archive exits 1 when not interactive', async () => {
    const err = await backupCommand(undefined, { restore: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('backupCommand --restore exits when the archive cannot be extracted', async () => {
    const junk = path.join(installDir, 'junk.tar.gz')
    fs.writeFileSync(junk, 'this is not a gzip tarball at all') // real tar -xzf fails
    const err = await backupCommand(junk, { restore: true, yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('backupCommand --restore exits when the archive has no database.sql', async () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-nodbsql-'))
    fs.mkdirSync(path.join(stage, 'empty'))
    fs.writeFileSync(path.join(stage, 'empty', 'readme.txt'), 'no dump here')
    const bad = path.join(home, 'no-dump.tar.gz')
    execSync(`tar -czf "${bad}" -C "${stage}" empty`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })
    await expect(backupCommand(bad, { restore: true, yes: true })).rejects.toBeInstanceOf(ProcessExit)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('backup interactive menu can route to restore', async () => {
    await backupCommand() // create an archive first
    const archive = latestArchive()
    setTTY(true)
    promptStub._s.selectValue = 'restore' // menu → restore
    promptStub._s.textValue = archive      // prompt for the archive path
    dockerMock.dockerExecFromFile.mockClear()
    await backupCommand()
    // Prove the menu actually ROUTED to restore (ran psql) rather than no-opping.
    expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith(
      'cid-db', ['sh', '-c', expect.stringContaining('psql')], expect.stringMatching(/database\.sql$/),
    )
  })

  it('backupCommand --restore extracts and restores from an archive', async () => {
    await backupCommand()
    const archive = latestArchive()
    dockerMock.dockerExecFromFile.mockClear()
    await expect(backupCommand(archive, { restore: true, yes: true })).resolves.toBeUndefined()
    // Prove the restore ACTUALLY ran psql against the right container with the
    // extracted dump, in one transaction that stops at the first error and
    // replaces the public schema.
    const psql = psqlCalls()
    expect(psql).toHaveLength(1)
    expect(psql[0][0]).toBe('cid-db')
    expect(psql[0][2]).toMatch(/database\.sql$/)
    const script = psql[0][1][2] as string
    expect(script).toContain('ON_ERROR_STOP=1')
    expect(script).toContain('--single-transaction')
    expect(script).toContain('DROP SCHEMA IF EXISTS public CASCADE')
    expect(script).toContain('-f -')

    // The app is stopped around the schema swap, then the stack comes back up
    // and the uploaded content is put back into the app container.
    expect(dockerMock.dockerComposeStop).toHaveBeenCalledWith(installDir, 'learnhouse-app')
    expect(dockerMock.dockerComposeUp).toHaveBeenCalledWith(installDir)
    const stopAt = dockerMock.dockerComposeStop.mock.invocationCallOrder[0]
    const psqlAt = dockerMock.dockerExecFromFile.mock.invocationCallOrder[0]
    const upAt = dockerMock.dockerComposeUp.mock.invocationCallOrder[0]
    expect(stopAt).toBeLessThan(psqlAt)
    expect(psqlAt).toBeLessThan(upAt)
    expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith(
      'cid-learnhouse-app', ['tar', '-C', '/app/api/content', '-xf', '-'], expect.stringMatching(/content\.tar$/),
    )
    expect(dockerMock.dockerExecFromFile.mock.invocationCallOrder[1]).toBeGreaterThan(upAt)
  })

  it('restore on an Enterprise install stops only the running db clients', async () => {
    await backupCommand()
    const archive = latestArchive()
    writeConfig({ edition: 'enterprise' })
    dockerMock.composeServiceContainer.mockImplementation((_dir: string, svc: string) => svc === 'collab' ? '' : `cid-${svc}`)

    await expect(restoreCommand(archive, { yes: true })).resolves.toBeUndefined()
    expect(dockerMock.dockerComposeStop.mock.calls).toEqual([[installDir, 'api']])
    expect(dockerMock.dockerComposeUp).toHaveBeenCalledWith(installDir)
    // EE content lives in the api container.
    expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith(
      'cid-api', ['tar', '-C', '/app/content', '-xf', '-'], expect.stringMatching(/content\.tar$/),
    )
  })

  it('restore of a .sql.gz dump (from `learnhouse update`) feeds the gunzipped SQL to psql', async () => {
    const sql = 'CREATE TABLE pre_upgrade (id int);\n'
    const gz = path.join(home, 'pre-update-1.5.0.sql.gz')
    fs.writeFileSync(gz, zlib.gzipSync(sql))

    await expect(restoreCommand(gz, { yes: true })).resolves.toBeUndefined()
    expect(restoredSql).toEqual([sql])
    expect(psqlCalls()[0][2]).toMatch(/database\.sql$/) // the decompressed copy, not the .gz
    expect(dockerMock.dockerExecFromFile).toHaveBeenCalledTimes(1) // a bare dump carries no content
    expect(dockerMock.dockerComposeUp).toHaveBeenCalledWith(installDir)
    expect(fs.existsSync(gz)).toBe(true) // the source dump is left alone
    expect(restoreDirs()).toEqual([])
  })

  it('a stale extracted folder in the install dir cannot be picked up by a later restore', async () => {
    // Leftovers of an earlier, aborted run at the old fixed path and at a
    // mkdtemp-style path. Each run must extract into its own fresh dir.
    for (const stale of ['.restore-tmp', '.restore-AbC123']) {
      fs.mkdirSync(path.join(installDir, stale, 'old-backup'), { recursive: true })
      fs.writeFileSync(path.join(installDir, stale, 'old-backup', 'database.sql'), 'STALE DUMP;\n')
    }

    // An archive with no database.sql must fail, not fall back to a stale dump.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-stale-'))
    fs.mkdirSync(path.join(stage, 'empty'))
    fs.writeFileSync(path.join(stage, 'empty', 'readme.txt'), 'no dump here')
    const bad = path.join(home, 'no-dump.tar.gz')
    execSync(`tar -czf "${bad}" -C "${stage}" empty`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })
    const err = await restoreCommand(bad, { yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()

    // A valid archive restores ITS dump, never the stale one.
    await backupCommand()
    await expect(restoreCommand(latestArchive(), { yes: true })).resolves.toBeUndefined()
    expect(restoredSql).toEqual([DUMP_SQL])
    for (const stale of ['.restore-tmp', '.restore-AbC123']) {
      expect(psqlCalls()[0][2].startsWith(path.join(installDir, stale) + path.sep)).toBe(false)
    }
    expect(restoreDirs().sort()).toEqual(['.restore-AbC123', '.restore-tmp']) // only the leftovers remain
  })

  it('backup exits and cleans up when the pg_dump fails', async () => {
    dockerMock.dockerExecToFile.mockImplementation(() => { throw new Error('pg_dump failed') })
    const err = await backupCommand().catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    // The staging dir must be removed even on failure.
    const backupsDir = path.join(installDir, 'backups')
    if (fs.existsSync(backupsDir)) {
      expect(fs.readdirSync(backupsDir).filter((e) => !e.endsWith('.tar.gz'))).toHaveLength(0)
    }
  })

  it('backup treats an empty dump as a failure', async () => {
    dockerMock.dockerExecToFile.mockImplementation((_c: string, _cmd: string[], out: string) => fs.writeFileSync(out, ''))
    const error = vi.spyOn(promptStub.log, 'error')
    const err = await backupCommand().catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('empty dump'))
    expect(fs.readdirSync(path.join(installDir, 'backups'))).toEqual([]) // no archive, no staging dir
  })

  it('backup exits when the database container is not running', async () => {
    dockerMock.composeServiceContainer.mockImplementation((_dir: string, svc: string) => svc === 'db' ? '' : `cid-${svc}`)
    const err = await backupCommand().catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecToFile).not.toHaveBeenCalled()
  })

  it('restore exits when the archive cannot be extracted', async () => {
    const junk = path.join(installDir, 'junk.tar.gz')
    fs.writeFileSync(junk, 'this is not a gzip tarball at all') // real tar -xzf fails
    await expect(restoreCommand(junk, { yes: true })).rejects.toBeInstanceOf(ProcessExit)
    expect(restoreDirs()).toEqual([]) // cleaned up
    expect(dockerMock.dockerComposeStop).not.toHaveBeenCalled() // nothing stopped for an unreadable backup
  })

  it('restore exits when the database restore command fails', async () => {
    await backupCommand() // make a valid archive that extracts fine
    const archive = latestArchive()
    dockerMock.dockerExecFromFile.mockImplementation(() => { throw new Error('psql restore failed') })
    await expect(restoreCommand(archive, { yes: true })).rejects.toBeInstanceOf(ProcessExit)
    expect(restoreDirs()).toEqual([]) // cleaned up
  })

  it('restore cancels when the user declines the confirmation', async () => {
    await backupCommand()
    const archive = latestArchive()
    promptStub._s.confirmValue = false
    setTTY(true)
    const err = await restoreCommand(archive).catch((e) => e) // confirm declined → exit(0)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(0)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('restore exits when the database container is not running', async () => {
    dockerMock.composeServiceContainer.mockImplementation((_dir: string, svc: string) => svc === 'db' ? '' : `cid-${svc}`)
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x')
    const err = await restoreCommand(dummy, { yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('restore in a cwd install without a deployment id targets that directory\'s compose db', async () => {
    // The db container is resolved via `docker compose ps` in the install dir,
    // so a legacy config without a deploymentId still addresses the right stack.
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-rnoid-'))
    fs.writeFileSync(path.join(cwdDir, 'learnhouse.config.json'), JSON.stringify({
      version: '1.4.8', createdAt: '2026-01-01T00:00:00Z', // no deploymentId
      installDir: '/somewhere/else', domain: 'localhost', httpPort: 8080,
      useHttps: false, autoSsl: false, useExternalDb: false, orgSlug: 'default',
    }))
    fs.writeFileSync(path.join(cwdDir, '.env'), 'X=1\n')
    const dump = path.join(cwdDir, 'dump.sql')
    fs.writeFileSync(dump, 'SELECT 1;\n')
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-rnoid-home-'))
    const origCwd = process.cwd()
    process.env.HOME = emptyHome
    process.chdir(cwdDir)
    try {
      await expect(restoreCommand(dump, { yes: true })).resolves.toBeUndefined()
      const realCwd = fs.realpathSync(cwdDir)
      expect(dockerMock.composeServiceContainer).toHaveBeenCalledWith(realCwd, 'db')
      expect(dockerMock.dockerExecFromFile).toHaveBeenCalledWith('cid-db', ['sh', '-c', expect.stringContaining('psql')], dump)
      expect(restoredSql).toEqual(['SELECT 1;\n'])
      expect(restoreDirs(cwdDir)).toEqual([])
    } finally {
      process.chdir(origCwd)
      process.env.HOME = home
      fs.rmSync(cwdDir, { recursive: true, force: true })
      fs.rmSync(emptyHome, { recursive: true, force: true })
    }
  })

  it('restore exits when no db container can be resolved for an install without a deployment id', async () => {
    writeConfig({ deploymentId: undefined })
    dockerMock.composeServiceContainer.mockReturnValue('')
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x')
    const err = await restoreCommand(dummy, { yes: true }).catch((e) => e)
    expect(err).toBeInstanceOf(ProcessExit)
    expect(err.code).toBe(1)
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('backup and restore refuse an external database', async () => {
    writeConfig({ useExternalDb: true })
    await expect(backupCommand()).rejects.toBeInstanceOf(ProcessExit)
    const dummy = path.join(installDir, 'dummy.tar.gz')
    fs.writeFileSync(dummy, 'x') // exists → restore reaches the external-db guard
    await expect(restoreCommand(dummy, { yes: true })).rejects.toBeInstanceOf(ProcessExit)
    expect(dockerMock.dockerExecToFile).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('backup and restore refuse a compose stack with no db service (external database)', async () => {
    // Config still says local, but the compose file has no `db` service.
    fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services:\n  learnhouse-app:\n    image: x\n  redis:\n    image: y\n')
    const err1 = await backupCommand().catch((e) => e)
    expect(err1).toBeInstanceOf(ProcessExit)
    expect(err1.code).toBe(1)
    const dummy = path.join(installDir, 'dummy.sql')
    fs.writeFileSync(dummy, 'SELECT 1;')
    const err2 = await restoreCommand(dummy, { yes: true }).catch((e) => e)
    expect(err2).toBeInstanceOf(ProcessExit)
    expect(err2.code).toBe(1)
    expect(dockerMock.composeServiceContainer).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecToFile).not.toHaveBeenCalled()
    expect(dockerMock.dockerExecFromFile).not.toHaveBeenCalled()
  })

  it('non-interactive restore leaves the live .env alone', async () => {
    await backupCommand()
    const archive = latestArchive()
    // .env carries secrets that must match the db volume: never swapped without asking.
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=changed\n')
    await backupCommand(archive, { restore: true, yes: true })
    expect(restoredSql).toEqual([DUMP_SQL])
    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8')).toBe('LEARNHOUSE_DOMAIN=changed\n')
  })

  it('restore restores the .env in interactive mode when confirmed', async () => {
    await backupCommand()
    const archive = latestArchive()
    setTTY(true)
    fs.writeFileSync(path.join(installDir, '.env'), 'LEARNHOUSE_DOMAIN=changed\n')
    await restoreCommand(archive) // confirm=true (stub) → restore + .env restore
    expect(fs.readFileSync(path.join(installDir, '.env'), 'utf-8')).toContain('LEARNHOUSE_DOMAIN=localhost')
    expectMode(path.join(installDir, '.env'), 0o600)
  })

  it('restore rejects an archive with no database.sql inside', async () => {
    // Build a tar.gz that contains a folder but no database.sql.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-br-bad-'))
    fs.mkdirSync(path.join(stage, 'empty'))
    fs.writeFileSync(path.join(stage, 'empty', 'readme.txt'), 'no dump here')
    const bad = path.join(home, 'bad.tar.gz')
    execSync(`tar -czf "${bad}" -C "${stage}" empty`, { stdio: 'pipe' })
    fs.rmSync(stage, { recursive: true, force: true })

    await expect(restoreCommand(bad, { yes: true })).rejects.toBeInstanceOf(ProcessExit)
    expect(restoreDirs()).toEqual([])
  })
})
