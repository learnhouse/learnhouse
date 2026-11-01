import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { VERSION } from '../constants.js'
import { readConfig, findInstallDir } from '../services/config-store.js'
import {
  composeServiceContainer,
  dockerComposeStop,
  dockerComposeUp,
  dockerExecToFile,
  dockerExecFromFile,
} from '../services/docker.js'
import { stackLayout, usesExternalDb, usesS3Content } from '../services/stack.js'
import type { LearnHouseConfigJson } from '../types.js'

// Both editions set POSTGRES_USER / POSTGRES_DB inside the db container, so the
// dump and restore read them there instead of assuming `learnhouse`.
const PG_DUMP = 'pg_dump -U "${POSTGRES_USER:-learnhouse}" --clean --if-exists "${POSTGRES_DB:-learnhouse}"'
// One transaction, stop at the first error: a failed restore rolls back to the
// pre-restore database instead of leaving it half-applied while reporting
// success. The public schema is recreated first so tables added after the
// backup (by later migrations) don't survive next to an older alembic_version.
const PSQL_RESTORE =
  'PGOPTIONS=--client-min-messages=warning psql -q -U "${POSTGRES_USER:-learnhouse}" -d "${POSTGRES_DB:-learnhouse}" ' +
  '-v ON_ERROR_STOP=1 --single-transaction ' +
  '-c "DROP SCHEMA IF EXISTS public CASCADE" -c "CREATE SCHEMA public" -f -'

interface BackupMeta {
  cliVersion: string
  deploymentId: string
  edition: string
  createdAt: string
  content: boolean
}

function errorDetail(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string }
  return (e?.stderr?.toString().trim() || e?.message || String(err)).slice(0, 800)
}

/**
 * A failure inside a try/finally. `process.exit` never runs pending `finally`
 * blocks, so failing steps throw this instead: cleanup and restarting stopped
 * services happen first, and `exitOnFailure` exits at the very end.
 */
class StepFailed extends Error {}

function fail(message: string): never {
  p.log.error(message)
  throw new StepFailed(message)
}

export async function exitOnFailure(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (err instanceof StepFailed) process.exit(1)
    throw err
  }
}

function loadInstall(): { dir: string; config: LearnHouseConfigJson } {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }
  return { dir, config }
}

function requireLocalDb(dir: string, config: LearnHouseConfigJson, action: 'Backup' | 'Restore'): string {
  if (config.useExternalDb || usesExternalDb(dir)) {
    p.log.error(`${action} is only supported for local (Docker) databases.`)
    p.log.info(`For external databases, use your database provider's ${action.toLowerCase()} tools.`)
    process.exit(1)
  }
  const db = composeServiceContainer(dir, 'db')
  if (!db) {
    p.log.error('Database container is not running. Start services first.')
    process.exit(1)
  }
  return db
}

async function createBackup() {
  const { dir: installDir, config } = loadInstall()
  const dbContainer = requireLocalDb(installDir, config, 'Backup')
  const layout = stackLayout(config)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(installDir, 'backups')
  const backupName = `learnhouse-backup-${timestamp}`
  const stagingDir = path.join(backupDir, backupName)
  const archivePath = path.join(backupDir, `${backupName}.tar.gz`)

  // Backups hold the full database and a copy of .env (every secret), so keep
  // them owner-only. chmod as well: mkdir's mode does not touch an existing dir.
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(backupDir, 0o700)
  } catch (err) {
    // Owned by another user (e.g. an earlier run under sudo). Everything this
    // command writes inside it is still owner-only.
    p.log.warn(`Could not restrict ${backupDir} to owner-only (${(err as { code?: string }).code ?? err}); check who owns it.`)
  }
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 })

  try {
    const s = p.spinner()
    s.start('Creating database dump')
    try {
      const dumpPath = path.join(stagingDir, 'database.sql')
      dockerExecToFile(dbContainer, ['sh', '-c', PG_DUMP], dumpPath)
      if (fs.statSync(dumpPath).size === 0) throw new Error('pg_dump produced an empty dump')
      s.stop('Database dump created')
    } catch (err) {
      s.stop('Database dump failed')
      fail(`Failed to create database dump: ${errorDetail(err)}`)
    }

    const envPath = path.join(installDir, '.env')
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, path.join(stagingDir, '.env'))
      fs.chmodSync(path.join(stagingDir, '.env'), 0o600)
    }

    // Uploaded files (course media, avatars...) live in the app's content
    // directory unless S3 is used; a database-only backup would lose them.
    let content = false
    if (!usesS3Content(installDir)) {
      const app = composeServiceContainer(installDir, layout.appService)
      if (!app) {
        p.log.warn(`The ${layout.appService} container is not running, so uploaded content is NOT in this backup.`)
      } else {
        const s2 = p.spinner()
        s2.start('Archiving uploaded content')
        try {
          // Exit 1 = "file changed as we read it" on a busy site: the archive is still complete.
          dockerExecToFile(app, ['tar', '-C', layout.contentPath, '-cf', '-', '.'], path.join(stagingDir, 'content.tar'), [0, 1])
          content = true
          s2.stop('Uploaded content archived')
        } catch (err) {
          s2.stop('Content archive failed')
          fs.rmSync(path.join(stagingDir, 'content.tar'), { force: true })
          p.log.warn(`Uploaded content is NOT in this backup: ${errorDetail(err)}`)
        }
      }
    }

    const meta: BackupMeta = {
      cliVersion: VERSION,
      deploymentId: config.deploymentId,
      edition: config.edition || 'community',
      createdAt: new Date().toISOString(),
      content,
    }
    fs.writeFileSync(path.join(stagingDir, 'backup.json'), JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })

    const s3 = p.spinner()
    s3.start('Creating archive')
    try {
      execFileSync('tar', ['-czf', archivePath, '-C', backupDir, backupName], { stdio: 'pipe' })
      fs.chmodSync(archivePath, 0o600)
      s3.stop('Archive created')
    } catch (err) {
      s3.stop('Archive creation failed')
      fs.rmSync(archivePath, { force: true })
      fail(`Failed to create archive: ${errorDetail(err)}`)
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }

  const stats = fs.statSync(archivePath)
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1)

  p.log.success(pc.green(pc.bold('Backup complete!')))
  p.log.message([
    '',
    `  ${pc.dim('File:')} ${archivePath}`,
    `  ${pc.dim('Size:')} ${sizeMb} MB`,
    '',
    `  ${pc.dim('Restore with:')} npx learnhouse restore ${archivePath}`,
    '',
  ].join('\n'))
}

/** Locate (or produce) the SQL dump inside an extracted archive or a bare `.sql[.gz]` dump. */
function prepareDump(archivePath: string, workDir: string): { dumpPath: string; folder: string | null } {
  const lower = archivePath.toLowerCase()
  if (lower.endsWith('.sql')) return { dumpPath: archivePath, folder: null }
  if (lower.endsWith('.sql.gz')) {
    // Pre-upgrade dumps written by `learnhouse update`.
    const dumpPath = path.join(workDir, 'database.sql')
    fs.writeFileSync(dumpPath, zlib.gunzipSync(fs.readFileSync(archivePath)), { mode: 0o600 })
    return { dumpPath, folder: null }
  }
  execFileSync('tar', ['-xzf', archivePath, '-C', workDir], { stdio: 'pipe' })
  if (fs.existsSync(path.join(workDir, 'database.sql'))) {
    return { dumpPath: path.join(workDir, 'database.sql'), folder: workDir }
  }
  const sub = fs.readdirSync(workDir).find((e) => fs.existsSync(path.join(workDir, e, 'database.sql')))
  if (!sub) throw new Error('No database.sql found in the backup archive.')
  return { dumpPath: path.join(workDir, sub, 'database.sql'), folder: path.join(workDir, sub) }
}

function readMeta(folder: string | null): Partial<BackupMeta> {
  if (!folder) return {}
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, 'backup.json'), 'utf-8'))
  } catch {
    return {}
  }
}

export interface RestoreOptions {
  /** Skip the confirmation prompt (required when not running in a terminal). */
  yes?: boolean
}

/**
 * Restore a backup made by `learnhouse backup` (.tar.gz), or a bare dump
 * (`.sql`, or the `.sql.gz` written by `learnhouse update`). Shared by
 * `learnhouse restore` and `learnhouse backup --restore`.
 */
export async function restoreBackup(archivePath: string, options: RestoreOptions = {}) {
  if (!fs.existsSync(archivePath)) {
    p.log.error(`Backup file not found: ${archivePath}`)
    process.exit(1)
  }

  const { dir: installDir, config } = loadInstall()
  const dbContainer = requireLocalDb(installDir, config, 'Restore')
  const layout = stackLayout(config)
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY

  p.log.warn(pc.yellow(`This will overwrite the database of ${installDir} with the backup data.`))
  if (!options.yes) {
    if (!interactive) {
      p.log.error('Refusing to overwrite the database without confirmation. Re-run with --yes.')
      process.exit(1)
    }
    const confirm = await p.confirm({
      message: 'Are you sure you want to restore from this backup?',
      initialValue: false,
    })
    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Restore cancelled.')
      process.exit(0)
    }
  }

  // A fresh private dir per run: a fixed path could hand an earlier, aborted
  // run's extracted dump to this one.
  const workDir = fs.mkdtempSync(path.join(installDir, '.restore-'))
  // Services this run stopped, so they are started again whatever happens.
  const stopped: string[] = []
  try {
    const s = p.spinner()
    s.start('Reading backup')
    let dump: { dumpPath: string; folder: string | null }
    try {
      dump = prepareDump(archivePath, workDir)
      s.stop('Backup read')
    } catch (err) {
      s.stop('Could not read backup')
      fail(`Failed to read backup: ${errorDetail(err)}`)
    }
    const meta = readMeta(dump.folder)

    // Nothing may hold connections or write while the schema is replaced.
    const running = layout.dbClients.filter((svc) => composeServiceContainer(installDir, svc))
    for (const svc of running) {
      stopped.push(svc)
      dockerComposeStop(installDir, svc)
    }

    const s2 = p.spinner()
    s2.start('Restoring database')
    try {
      dockerExecFromFile(dbContainer, ['sh', '-c', PSQL_RESTORE], dump.dumpPath)
      s2.stop('Database restored')
    } catch (err) {
      s2.stop('Database restore failed')
      fail(`Restore failed and was rolled back; the database is unchanged.\n${errorDetail(err)}`)
    }

    // .env is only offered interactively: it carries secrets that must match
    // the database volume, and can belong to another install.
    const envBackup = dump.folder ? path.join(dump.folder, '.env') : ''
    if (envBackup && fs.existsSync(envBackup) && interactive) {
      if (meta.deploymentId && meta.deploymentId !== config.deploymentId) {
        p.log.warn(`This backup came from another deployment (${meta.deploymentId}); its .env may not match this install.`)
      }
      const restoreEnv = await p.confirm({
        message: 'Backup contains a .env file. Restore it? (overwrites current .env)',
        initialValue: false,
      })
      if (!p.isCancel(restoreEnv) && restoreEnv) {
        fs.copyFileSync(envBackup, path.join(installDir, '.env'))
        fs.chmodSync(path.join(installDir, '.env'), 0o600)
        p.log.info('.env file restored')
      }
    }

    // Start what we stopped, then put uploaded content back.
    if (stopped.length > 0) {
      dockerComposeUp(installDir)
      stopped.length = 0
    }
    const contentTar = dump.folder ? path.join(dump.folder, 'content.tar') : ''
    if (contentTar && fs.existsSync(contentTar)) {
      const app = composeServiceContainer(installDir, layout.appService)
      if (!app) {
        p.log.warn(`Could not restore uploaded content: ${layout.appService} is not running. Archive kept at ${archivePath}.`)
      } else {
        const s3 = p.spinner()
        s3.start('Restoring uploaded content')
        try {
          dockerExecFromFile(app, ['tar', '-C', layout.contentPath, '-xf', '-'], contentTar)
          s3.stop('Uploaded content restored')
        } catch (err) {
          s3.stop('Content restore failed')
          p.log.warn(`Uploaded content was not restored: ${errorDetail(err)}`)
        }
      }
    }
  } finally {
    if (stopped.length > 0) {
      try { dockerComposeUp(installDir) } catch { /* reported by docker */ }
    }
    fs.rmSync(workDir, { recursive: true, force: true })
  }

  p.log.success(pc.green(pc.bold('Restore complete!')))
}

export async function backupCommand(archivePath?: string, options?: { restore?: boolean; yes?: boolean }) {
  if (options?.restore) {
    p.intro(pc.cyan('LearnHouse Restore'))
    if (!archivePath) {
      if (!process.stdin.isTTY) {
        p.log.error('Usage: npx learnhouse backup --restore <backup-file.tar.gz>')
        process.exit(1)
      }
      const filePath = await p.text({
        message: 'Path to backup archive (.tar.gz)',
        placeholder: './backups/learnhouse-backup-*.tar.gz',
      })
      if (p.isCancel(filePath)) { p.cancel(); process.exit(0) }
      archivePath = filePath as string
    }
    await exitOnFailure(() => restoreBackup(archivePath!, { yes: options.yes }))
    return
  }

  if (archivePath) {
    p.log.error(`Unexpected argument "${archivePath}". To restore it, run: npx learnhouse restore ${archivePath}`)
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Backup'))

  // Non-interactive: create (the safe action) without asking
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await exitOnFailure(createBackup)
    return
  }

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'create', label: 'Create a backup' },
      { value: 'restore', label: 'Restore from a backup' },
    ],
  })
  if (p.isCancel(action)) { p.cancel(); process.exit(0) }

  if (action === 'create') {
    await exitOnFailure(createBackup)
  } else {
    const filePath = await p.text({
      message: 'Path to backup archive (.tar.gz)',
      placeholder: './backups/learnhouse-backup-*.tar.gz',
    })
    if (p.isCancel(filePath)) { p.cancel(); process.exit(0) }
    await exitOnFailure(() => restoreBackup(filePath as string, { yes: options?.yes }))
  }
}
