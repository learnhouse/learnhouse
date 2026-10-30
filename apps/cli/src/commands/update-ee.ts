import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import type { LearnHouseConfigJson } from '../types.js'
import {
  composeServiceContainer,
  dockerComposeExec,
  dockerComposeRun,
  dockerComposeStop,
  dockerComposeUp,
  dockerExecToFile,
} from '../services/docker.js'
import { usesExternalDb } from '../services/stack.js'
import { readEnvVar, setEnvVar } from '../utils/env-file.js'
import { IMAGE_TAG_RE } from '../utils/validators.js'

// Shared upgrade helpers used by BOTH the Community and Enterprise update paths:
// a pre-upgrade DB backup, Alembic baseline stamping (for create_all installs),
// and migration execution, parameterized by where each edition keeps things.

export { readEnvVar, setEnvVar }

export interface UpdateLog {
  log: (m: string) => void
  ok: (m: string) => void
  warn: (m: string) => void
}

/** Which container service + alembic working dir + DB layout an edition uses. */
export interface EditionLayout {
  appService: string      // compose service running the API (EE: 'api', CE: 'learnhouse-app')
  alembicCwd: string      // where alembic.ini lives in that image (EE: '/app', CE: '/app/api')
  dbService: string       // in-container Postgres service name ('db' for both)
}

/** External DB when the compose file has no `db` service. (Every Community
 *  .env carries LEARNHOUSE_SQL_CONNECTION_STRING, pointing at `db`, so the
 *  variable alone says nothing.) */
export function isExternalDbInstall(installDir: string): boolean {
  return usesExternalDb(installDir)
}

function alembic(cwd: string, layout: EditionLayout, args: string): string {
  return dockerComposeExec(cwd, layout.appService, `cd ${layout.alembicCwd} && uv run alembic ${args}`)
}

// pg_dump must be at least the server's major version, and a newer pg_dump can
// still dump older servers, so pin a recent client image for the external-DB
// dump path (works for current managed Postgres and older in-container DBs).
const PG_CLIENT_IMAGE = 'postgres:17'

export { IMAGE_TAG_RE }

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** pg_dump the DB to ./backups before any change. Works for in-container and
 *  external databases (dialed via a client sharing the app's network). The dump
 *  is written plain, its exit status checked (no `| gzip` hiding a pg_dump that
 *  died halfway), then compressed in-process. */
export async function backupDatabase(config: LearnHouseConfigJson, layout: EditionLayout, ui: UpdateLog): Promise<string> {
  const dir = config.installDir
  const backupsDir = path.join(dir, 'backups')
  // A full database dump: owner-only. chmod too, since mkdir's mode does not
  // touch a directory that already exists. That directory may belong to
  // another user (an earlier run under sudo); the dump file itself is still
  // created 0600, so warn instead of aborting the update before the backup.
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(backupsDir, 0o700)
  } catch (err) {
    ui.warn(`could not restrict ${backupsDir} to owner-only (${(err as { code?: string }).code ?? err}); check who owns it`)
  }
  const out = path.join(backupsDir, `db-pre-upgrade-${timestamp()}.sql.gz`)
  const raw = out.replace(/\.gz$/, '')

  try {
    if (config.useExternalDb || isExternalDbInstall(dir)) {
      const conn = readEnvVar(dir, 'LEARNHOUSE_SQL_CONNECTION_STRING') || ''
      // Share the RUNNING app container's network namespace so the dump client
      // reaches the external DB exactly as the app does. This avoids guessing the
      // compose network name (which differs by edition) and inherits the app's
      // connectivity (e.g. IPv6-only databases).
      const cid = composeServiceContainer(dir, layout.appService)
      if (!cid) throw new Error(`app container (${layout.appService}) is not running; start the stack before backing up`)
      ui.log('external database: dumping via a client sharing the app container network')
      const fd = fs.openSync(raw, 'w', 0o600)
      try {
        const res = spawnSync(
          'docker',
          ['run', '--rm', '--network', `container:${cid}`, '-e', 'PGCONN', PG_CLIENT_IMAGE, 'sh', '-c', 'pg_dump "$PGCONN"'],
          { cwd: dir, stdio: ['ignore', fd, 'inherit'], env: { ...process.env, PGCONN: conn } },
        )
        if (res.error) throw res.error
        if (res.status !== 0) throw new Error(`pg_dump exited with ${res.status}`)
      } finally {
        fs.closeSync(fd)
      }
    } else {
      const db = composeServiceContainer(dir, layout.dbService)
      if (!db) throw new Error(`database container (${layout.dbService}) is not running; start the stack before backing up`)
      ui.log('in-container database: pg_dump from the db service')
      dockerExecToFile(db, ['sh', '-c', 'pg_dump -U "${POSTGRES_USER:-learnhouse}" "${POSTGRES_DB:-learnhouse}"'], raw)
    }

    const bytes = fs.statSync(raw).size
    if (bytes < 100) throw new Error(`backup looks empty (${bytes} bytes); aborting before any changes`)

    await pipeline(fs.createReadStream(raw), zlib.createGzip(), fs.createWriteStream(out, { mode: 0o600 }))
  } catch (err) {
    fs.rmSync(out, { force: true })
    throw err
  } finally {
    fs.rmSync(raw, { force: true })
  }
  return out
}

/** Revision ids parsed from `alembic current` / `alembic heads` output. Revision
 *  lines start at column 0 with a lowercase-alnum id (alembic's INFO logs go to
 *  stderr and any app warnings start uppercase), so a line-anchored match is safe. */
function parseRevs(out: string): Set<string> {
  const revs = new Set<string>()
  for (const raw of out.split('\n')) {
    const m = raw.trim().match(/^([0-9a-z]{8,40})\b/)
    if (m) revs.add(m[1])
  }
  return revs
}

/** If the DB was created via the app's startup create_all and never stamped,
 *  stamp the CURRENT image's head(s) so a later `upgrade` applies only the new
 *  delta instead of replaying everything (which would error on existing tables).
 *  Uses `heads` (plural) so it also works on images that ship multiple heads. */
export function ensureAlembicBaseline(dir: string, layout: EditionLayout, ui: UpdateLog): void {
  try {
    const stamped = parseRevs(alembic(dir, layout, 'current 2>/dev/null')).size > 0
    if (!stamped) {
      ui.log('Database not Alembic-stamped (created via create_all); stamping current schema as the baseline…')
      alembic(dir, layout, 'stamp heads')
      ui.ok('Baseline stamped at the current version')
    } else {
      ui.ok('Alembic baseline present')
    }
  } catch (err) {
    ui.warn(`Could not establish Alembic baseline: ${(err as Error)?.message ?? err}. Proceeding; review migrations if they fail.`)
  }
}

/** Bring the DB up to head(s). Returns true on success.
 *  Skips the upgrade when the DB already carries every head (e.g. a freshly
 *  create_all'd schema we just stamped); that's a no-op and avoids erroring on
 *  images whose migration tree exposes multiple/overlapping heads.
 *
 *  `previousHeads` are the heads the pre-upgrade image shipped. An unstamped
 *  database matches *that* schema, so it is the only safe stamp target:
 *  stamping the new image's heads would mark every column migration in
 *  between as applied without running it (create_all adds tables, never
 *  columns). */
export function runAlembicUpgrade(dir: string, layout: EditionLayout, ui: UpdateLog, previousHeads: string[] = []): boolean {
  try {
    // Alembic marks the current revision "(head)" when the DB is at the tip of
    // its lineage. If every current revision is a head, there's nothing to apply
    // and we skip. This is more reliable than diffing `current` against `heads` (alembic
    // collapses `current` to the effective tip) and avoids erroring on images that
    // expose a stray/duplicate extra head, where `upgrade heads` reports
    // "overlaps with other requested revisions".
    const current = alembic(dir, layout, 'current 2>/dev/null')
    const revLines = current.split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-z]{8,40}\b/.test(l))
    if (revLines.length > 0 && revLines.every((l) => /head\)/i.test(l))) {
      ui.ok('Database already at head, no migrations needed')
      return true
    }

    // If the DB has no tracked revision it was bootstrapped via create_all (not
    // by running migrations). Attempt the normal upgrade first; if it fails
    // because the initial tables already exist, stamp at the previous image's
    // heads and apply the real delta from there.
    if (revLines.length === 0) {
      try {
        const out = alembic(dir, layout, 'upgrade heads')
        const applied = out.split('\n').filter((l) => /Running upgrade/.test(l)).length
        ui.ok(applied ? `Applied ${applied} migration(s)` : 'Database migrated to head')
        return true
      } catch (upgradeErr) {
        const e2 = upgradeErr as { stderr?: { toString(): string }; stdout?: { toString(): string } }
        const upgradeOut = (e2.stderr?.toString() ?? '') + (e2.stdout?.toString() ?? '')
        if (!/already exists|DuplicateTable/i.test(upgradeOut)) throw upgradeErr
        if (previousHeads.length === 0) {
          ui.warn('Database was created via create_all and has no Alembic revision, and the previous version\'s revision is unknown.')
          ui.warn(`  Stamp it at the revision of the version it was created with, then upgrade: docker compose exec ${layout.appService} sh -c "cd ${layout.alembicCwd} && uv run alembic stamp <revision> && uv run alembic upgrade heads"`)
          return false
        }
        alembic(dir, layout, `stamp ${previousHeads.join(' ')}`)
        const out = alembic(dir, layout, 'upgrade heads')
        const applied = out.split('\n').filter((l) => /Running upgrade/.test(l)).length
        ui.ok(`Schema created via create_all; stamped at the previous revision and applied ${applied} migration(s)`)
        return true
      }
    }

    const out = alembic(dir, layout, 'upgrade heads')
    const applied = out.split('\n').filter((l) => /Running upgrade/.test(l)).length
    ui.ok(applied ? `Applied ${applied} migration(s)` : 'Database migrated to head')
    return true
  } catch (err) {
    const e = err as { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string }
    const detail = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').trim()
    if (detail) console.error(pc.dim(detail.slice(0, 800)))
    ui.warn('Migrations failed; your DB backup is in ./backups/.')
    ui.warn(`  Retry manually: docker compose exec ${layout.appService} sh -c "cd ${layout.alembicCwd} && uv run alembic upgrade heads"`)
    return false
  }
}

/** Migration heads shipped by the *running* image, read from its migration
 *  scripts alone, with no database round-trip. Older images ship an alembic env.py
 *  that ignores LEARNHOUSE_SQL_CONNECTION_STRING and dials localhost, so
 *  `current` and `stamp` fail inside them, but `heads` still answers, and it is
 *  exactly the revision their create_all schema corresponds to. */
export function readAlembicHeads(dir: string, layout: EditionLayout): string[] {
  try {
    return [...parseRevs(alembic(dir, layout, 'heads 2>/dev/null'))]
  } catch {
    return []
  }
}

/** Bring the database to head with the NEW image before that image boots.
 *
 *  The API's startup probes SELECT columns that only a migration adds, so a
 *  newer image started against an un-migrated database crash-loops and the
 *  post-start migration step never gets to run. Instead a one-off container of
 *  the freshly pulled image runs alembic against the database while the old
 *  version keeps serving. A database with no alembic_version (built by the
 *  old image's create_all) is first stamped at the old image's heads, so only
 *  the real delta is applied; stamping it at the *new* heads would skip every
 *  column migration in between. */
export function migrateBeforeBoot(dir: string, layout: EditionLayout, previousHeads: string[], ui: UpdateLog): boolean {
  const run = (args: string) =>
    dockerComposeRun(dir, layout.appService, `cd ${layout.alembicCwd} && uv run alembic ${args}`)
  try {
    const current = parseRevs(run('current 2>/dev/null'))
    if (current.size === 0) {
      if (previousHeads.length === 0) {
        ui.warn('Database has no Alembic revision and the previous image did not report one; migrations will run after startup instead.')
        return true
      }
      run(`stamp ${previousHeads.join(' ')}`)
      ui.log(`Database created via create_all; stamped at the previous image's revision (${previousHeads.join(', ')})`)
    }
    const out = run('upgrade heads')
    const applied = out.split('\n').filter((l) => /Running upgrade/.test(l)).length
    ui.ok(applied ? `Applied ${applied} migration(s) before starting the new image` : 'Database migrated to head before starting the new image')
    return true
  } catch (err) {
    const e = err as { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string }
    const detail = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').trim()
    if (detail) console.error(pc.dim(detail.slice(0, 800)))
    ui.warn('Pre-start migration failed; your DB backup is in ./backups/.')
    return false
  }
}

// ── Enterprise upgrade flow (license re-auth + EE images) ────────────────────
import {
  dockerLogin,
  dockerLogout,
  dockerComposePull,
  dockerComposeUpRetry,
} from '../services/docker.js'
import { waitForEeReady } from '../services/health.js'
import { EE_REGISTRY, EE_REGISTRY_USERNAME } from '../constants.js'

const EE_LAYOUT: EditionLayout = { appService: 'api', alembicCwd: '/app', dbService: 'db' }

export interface EeUpdateOptions {
  version?: string
  migrate?: boolean
  backup?: boolean
  interactive: boolean
}

export async function updateEnterprise(config: LearnHouseConfigJson, options: EeUpdateOptions): Promise<void> {
  const dir = config.installDir
  const ui: UpdateLog = {
    log: (m) => (options.interactive ? p.log.info(m) : console.log(m)),
    ok: (m) => (options.interactive ? p.log.success(m) : console.log('✓ ' + m)),
    warn: (m) => (options.interactive ? p.log.warn(m) : console.warn('! ' + m)),
  }
  const die = (m: string): never => { ui.warn(m); process.exit(1); throw new Error(m) }

  const targetTag = options.version ? options.version.replace(/^v(?=\d)/, '') : 'prod'
  if (!IMAGE_TAG_RE.test(targetTag)) die(`invalid version "${options.version}": expected an image tag like 1.6.0 or prod`)
  const currentTag = readEnvVar(dir, 'EE_IMAGE_TAG') || 'prod'
  ui.log(`Upgrading LearnHouse Enterprise: ${pc.dim(currentTag)} → ${pc.cyan(targetTag)}`)

  if (options.backup !== false) {
    try { ui.ok(`Backup: ${await backupDatabase(config, EE_LAYOUT, ui)}`) }
    catch (err) { die(`database backup failed: ${(err as Error)?.message ?? err}. Aborting; nothing changed.`) }
  } else {
    ui.warn('Skipping DB backup (--no-backup). Not recommended for production.')
  }

  ensureAlembicBaseline(dir, EE_LAYOUT, ui)
  // The revision the running image's create_all schema corresponds to, in case
  // stamping above failed (see runAlembicUpgrade).
  const previousHeads = readAlembicHeads(dir, EE_LAYOUT)

  const license = readEnvVar(dir, 'LEARNHOUSE_LICENSE_KEY')
  if (!license) die('LEARNHOUSE_LICENSE_KEY not found in .env; cannot pull EE images.')
  try { dockerLogin(EE_REGISTRY, EE_REGISTRY_USERNAME, license!); ui.ok('Authenticated to the EE registry') }
  catch (err) { die(`registry login failed (license expired?): ${(err as { stderr?: string })?.stderr ?? err}`) }

  setEnvVar(dir, 'EE_IMAGE_TAG', targetTag)
  // die() exits on the spot (no finally runs), so log out before it.
  try { dockerComposePull(dir); dockerLogout(EE_REGISTRY); ui.ok(`Images pulled (${targetTag})`) }
  catch (err) {
    dockerLogout(EE_REGISTRY)
    setEnvVar(dir, 'EE_IMAGE_TAG', currentTag)
    die(`image pull failed (tag reverted to ${currentTag}): ${(err as Error)?.message ?? err}`)
  }

  // Migrate with the new image before it boots (see migrateBeforeBoot): a new
  // api crash-loops on an un-migrated schema, and `compose exec` can't run in a
  // crash-looping container. The api is stopped first so its open connections
  // don't block the migration's locks; the old version comes back on failure.
  if (options.migrate !== false) {
    dockerComposeStop(dir, EE_LAYOUT.appService)
    if (!migrateBeforeBoot(dir, EE_LAYOUT, previousHeads, ui)) {
      setEnvVar(dir, 'EE_IMAGE_TAG', currentTag)
      try { dockerComposeUp(dir) } catch { /* reported by docker */ }
      die(`Pre-start migration failed; restarted on ${currentTag}. Your DB backup is in ./backups/.`)
    }
  }

  ui.log('Recreating containers on the new version…')
  try { dockerComposeUpRetry(dir, 3, (n) => ui.warn(`start attempt ${n} failed; retrying in 15s…`)) }
  catch (err) { die(`failed to start the upgraded stack: ${(err as Error)?.message ?? err}. Restore from ./backups/ if needed.`) }

  const ready = await waitForEeReady(dir)
  if (ready === 'oss') ui.warn('API came up in OSS mode, license not active. Check `learnhouse logs`.')
  else if (ready === 'timeout') ui.warn('Could not confirm EE mode yet; the API may still be starting.')

  if (options.migrate !== false) {
    // Normally a no-op after the pre-start run.
    if (!runAlembicUpgrade(dir, EE_LAYOUT, ui, previousHeads)) {
      ui.warn(`Rollback: set EE_IMAGE_TAG=${currentTag} in .env, restore ./backups/, then docker compose up -d`)
      process.exit(1)
    }
  } else {
    ui.warn('Skipped migrations (--no-migrate). Run later: docker compose exec api sh -c "cd /app && uv run alembic upgrade head"')
  }

  ui.ok(`LearnHouse Enterprise upgraded to ${targetTag}.`)
  ui.log(pc.dim(`  Rollback: EE_IMAGE_TAG=${currentTag} in ${dir}/.env, restore ./backups/, docker compose up -d`))
}
