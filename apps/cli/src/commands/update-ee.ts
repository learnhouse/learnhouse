import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import type { LearnHouseConfigJson } from '../types.js'
import { dockerComposeExec } from '../services/docker.js'

// Shared upgrade helpers used by BOTH the Community and Enterprise update paths:
// a pre-upgrade DB backup, Alembic baseline stamping (for create_all installs),
// and migration execution — parameterized by where each edition keeps things.

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

export function readEnvVar(installDir: string, key: string): string | undefined {
  const envPath = path.join(installDir, '.env')
  if (!fs.existsSync(envPath)) return undefined
  const m = fs.readFileSync(envPath, 'utf-8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  if (!m) return undefined
  return m[1].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
}

export function setEnvVar(installDir: string, key: string, value: string): void {
  const envPath = path.join(installDir, '.env')
  let txt = fs.readFileSync(envPath, 'utf-8')
  if (new RegExp(`^${key}=`, 'm').test(txt)) {
    txt = txt.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
  } else {
    txt += (txt.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`
  }
  fs.writeFileSync(envPath, txt)
}

/** External DB if the .env carries a full connection string (no in-container db). */
export function isExternalDbInstall(installDir: string): boolean {
  return !!readEnvVar(installDir, 'LEARNHOUSE_SQL_CONNECTION_STRING')
}

function alembic(cwd: string, layout: EditionLayout, args: string): string {
  return dockerComposeExec(cwd, layout.appService, `sh -c "cd ${layout.alembicCwd} && uv run alembic ${args}"`)
}

// pg_dump must be at least the server's major version, and a newer pg_dump can
// still dump older servers, so pin a recent client image for the external-DB
// dump path (works for current managed Postgres and older in-container DBs).
const PG_CLIENT_IMAGE = 'postgres:17'

/** pg_dump the DB to ./backups before any change. Works for in-container and
 *  external databases (dialed via a client sharing the app's network). */
export function backupDatabase(config: LearnHouseConfigJson, layout: EditionLayout, ui: UpdateLog): string {
  const dir = config.installDir
  const backupsDir = path.join(dir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const stamp = execSync('date +%Y%m%d-%H%M%S').toString().trim()
  const out = path.join(backupsDir, `db-pre-upgrade-${stamp}.sql.gz`)

  if (isExternalDbInstall(dir)) {
    const conn = readEnvVar(dir, 'LEARNHOUSE_SQL_CONNECTION_STRING') || ''
    // Share the RUNNING app container's network namespace so the dump client
    // reaches the external DB exactly as the app does. This avoids guessing the
    // compose network name (which differs by edition) and inherits the app's
    // connectivity (e.g. IPv6-only databases).
    const cid = execSync(`docker compose ps -q ${layout.appService}`, { cwd: dir }).toString().trim()
    if (!cid) throw new Error(`app container (${layout.appService}) is not running — start the stack before backing up`)
    ui.log('external database — dumping via a client sharing the app container network')
    execSync(
      `docker run --rm --network ${JSON.stringify('container:' + cid)} -e PGCONN -i ${PG_CLIENT_IMAGE} ` +
        `sh -c 'pg_dump "$PGCONN" | gzip' > ${JSON.stringify(out)}`,
      { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PGCONN: conn } },
    )
  } else {
    ui.log('in-container database — pg_dump from the db service')
    execSync(
      `docker compose exec -T ${layout.dbService} sh -c 'pg_dump -U "$\{POSTGRES_USER:-learnhouse}" "$\{POSTGRES_DB:-learnhouse}"' | gzip > ${JSON.stringify(out)}`,
      { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] },
    )
  }
  const bytes = fs.statSync(out).size
  if (bytes < 100) throw new Error(`backup looks empty (${bytes} bytes) — aborting before any changes`)
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
      ui.log('Database not Alembic-stamped (created via create_all) — stamping current schema as the baseline…')
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
 *  create_all'd schema we just stamped) — that's a no-op and avoids erroring on
 *  images whose migration tree exposes multiple/overlapping heads. */
export function runAlembicUpgrade(dir: string, layout: EditionLayout, ui: UpdateLog): boolean {
  try {
    // Alembic marks the current revision "(head)" when the DB is at the tip of
    // its lineage. If every current revision is a head, there's nothing to apply
    // — skip. This is more reliable than diffing `current` against `heads` (alembic
    // collapses `current` to the effective tip) and avoids erroring on images that
    // expose a stray/duplicate extra head, where `upgrade heads` reports
    // "overlaps with other requested revisions".
    const current = alembic(dir, layout, 'current 2>/dev/null')
    const revLines = current.split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-z]{8,40}\b/.test(l))
    if (revLines.length > 0 && revLines.every((l) => /head\)/i.test(l))) {
      ui.ok('Database already at head — no migrations needed')
      return true
    }
    const out = alembic(dir, layout, 'upgrade heads')
    const applied = out.split('\n').filter((l) => /Running upgrade/.test(l)).length
    ui.ok(applied ? `Applied ${applied} migration(s)` : 'Database migrated to head')
    return true
  } catch (err) {
    const e = err as { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string }
    const detail = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').trim()
    if (detail) console.error(pc.dim(detail.slice(0, 800)))
    ui.warn('Migrations failed — your DB backup is in ./backups/.')
    ui.warn(`  Retry manually: docker compose exec ${layout.appService} sh -c "cd ${layout.alembicCwd} && uv run alembic upgrade heads"`)
    return false
  }
}

// ── Enterprise upgrade flow (license re-auth + EE images) ────────────────────
import {
  dockerLogin,
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

  const targetTag = options.version ? options.version.replace(/^v/, '') : 'prod'
  const currentTag = readEnvVar(dir, 'EE_IMAGE_TAG') || 'prod'
  ui.log(`Upgrading LearnHouse Enterprise: ${pc.dim(currentTag)} → ${pc.cyan(targetTag)}`)

  if (options.backup !== false) {
    try { ui.ok(`Backup: ${backupDatabase(config, EE_LAYOUT, ui)}`) }
    catch (err) { die(`database backup failed: ${(err as Error)?.message ?? err}. Aborting — nothing changed.`) }
  } else {
    ui.warn('Skipping DB backup (--no-backup). Not recommended for production.')
  }

  ensureAlembicBaseline(dir, EE_LAYOUT, ui)

  const license = readEnvVar(dir, 'LEARNHOUSE_LICENSE_KEY')
  if (!license) die('LEARNHOUSE_LICENSE_KEY not found in .env — cannot pull EE images.')
  try { dockerLogin(EE_REGISTRY, EE_REGISTRY_USERNAME, license!); ui.ok('Authenticated to the EE registry') }
  catch (err) { die(`registry login failed (license expired?): ${(err as { stderr?: string })?.stderr ?? err}`) }

  setEnvVar(dir, 'EE_IMAGE_TAG', targetTag)
  try { dockerComposePull(dir); ui.ok(`Images pulled (${targetTag})`) }
  catch (err) { setEnvVar(dir, 'EE_IMAGE_TAG', currentTag); die(`image pull failed (tag reverted to ${currentTag}): ${(err as Error)?.message ?? err}`) }

  ui.log('Recreating containers on the new version…')
  try { dockerComposeUpRetry(dir, 3, (n) => ui.warn(`start attempt ${n} failed; retrying in 15s…`)) }
  catch (err) { die(`failed to start the upgraded stack: ${(err as Error)?.message ?? err}. Restore from ./backups/ if needed.`) }

  const ready = await waitForEeReady(dir)
  if (ready === 'oss') ui.warn('API came up in OSS mode — license not active. Check `learnhouse logs`.')
  else if (ready === 'timeout') ui.warn('Could not confirm EE mode yet; the API may still be starting.')

  if (options.migrate !== false) {
    if (!runAlembicUpgrade(dir, EE_LAYOUT, ui)) {
      ui.warn(`Rollback: set EE_IMAGE_TAG=${currentTag} in .env, restore ./backups/, then docker compose up -d`)
      process.exit(1)
    }
  } else {
    ui.warn('Skipped migrations (--no-migrate). Run later: docker compose exec api sh -c "cd /app && uv run alembic upgrade head"')
  }

  ui.ok(`LearnHouse Enterprise upgraded to ${targetTag}.`)
  ui.log(pc.dim(`  Rollback: EE_IMAGE_TAG=${currentTag} in ${dir}/.env, restore ./backups/, docker compose up -d`))
}
