import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeStop, dockerComposeUp, dockerComposePull } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'
import { waitForAppHealth } from '../services/health.js'
import { replaceComposeImageTag } from '../services/compose-utils.js'
import { resolveAppImage } from '../services/version-check.js'
import { writeFileAtomic } from '../utils/fs-atomic.js'
import {
  updateEnterprise,
  backupDatabase,
  ensureAlembicBaseline,
  migrateBeforeBoot,
  readAlembicHeads,
  runAlembicUpgrade,
  IMAGE_TAG_RE,
  type EditionLayout,
} from './update-ee.js'

// Community (monolith) layout: one app container, alembic under /app/api, in-container db.
const COMMUNITY_LAYOUT: EditionLayout = { appService: 'learnhouse-app', alembicCwd: '/app/api', dbService: 'db' }

const GHCR_BASE = 'ghcr.io/learnhouse/app'

async function resolveTag(version: string): Promise<boolean> {
  try {
    const tokenResp = await fetch(
      'https://ghcr.io/token?scope=repository:learnhouse/app:pull',
      { signal: AbortSignal.timeout(5000) },
    )
    if (!tokenResp.ok) return false
    const { token } = (await tokenResp.json()) as { token: string }

    const manifestResp = await fetch(
      `https://ghcr.io/v2/learnhouse/app/manifests/${encodeURIComponent(version)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: {
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
          Authorization: `Bearer ${token}`,
        },
      },
    )
    return manifestResp.ok
  } catch {
    return false
  }
}

export async function updateCommand(options: { version?: string; migrate?: boolean; backup?: boolean }) {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
    return
  }

  // Enterprise installs use a different upgrade path: license re-auth, EE images,
  // a pre-upgrade DB backup, and Alembic migrations against the (possibly external) DB.
  if (config.edition === 'enterprise') {
    p.intro(pc.cyan('Upgrading LearnHouse Enterprise'))
    await updateEnterprise(config, {
      version: options.version,
      migrate: options.migrate,
      backup: options.backup,
      interactive: !!process.stdout.isTTY,
    })
    return
  }

  const targetVersion = options.version?.replace(/^v(?=\d)/, '')
  // The tag ends up in docker-compose.yml's `image:` line; anything beyond a
  // plain docker tag could inject YAML.
  if (targetVersion !== undefined && !IMAGE_TAG_RE.test(targetVersion)) {
    p.log.error(`Invalid version "${options.version}". Expected something like 1.6.0.`)
    process.exit(1)
  }

  if (targetVersion) {
    p.intro(pc.cyan(`Updating LearnHouse to v${targetVersion}`))
  } else {
    p.intro(pc.cyan('Updating LearnHouse to latest'))
  }

  const ui = {
    log: (m: string) => p.log.info(m),
    ok: (m: string) => p.log.success(m),
    warn: (m: string) => p.log.warn(m),
  }
  const composePath = join(config.installDir, 'docker-compose.yml')
  const originalCompose = readFileSync(composePath, 'utf-8')
  const s = p.spinner()
  // What to put back if anything fails after the image tag is rewritten.
  let rollbackCompose: string | null = null
  // Services this run stopped, which a failure must bring back up.
  let appStopped = false
  try {
    // 1) Back up the database first (safety net for migrations). Works for the
    //    in-container db AND an external one via the .env string.
    if (options.backup !== false) {
      s.start('Backing up the database')
      try {
        const b = await backupDatabase(config, COMMUNITY_LAYOUT, ui)
        s.stop('Database backed up')
        ui.ok(`Backup: ${b}`)
      } catch (err) {
        s.stop('Backup failed')
        p.log.error(`Database backup failed: ${(err as Error)?.message ?? err}. Aborting; nothing changed.`)
        process.exit(1)
      }
    } else {
      p.log.warn('Skipping database backup (--no-backup). Not recommended for production.')
    }
    // 2) Stamp an Alembic baseline if the DB was created via create_all and never stamped.
    ensureAlembicBaseline(config.installDir, COMMUNITY_LAYOUT, ui)
    // Remember which migration heads the running image ships: if stamping
    // failed (old images can't run alembic against the compose db), this is
    // the revision the new image must stamp before applying its delta.
    const previousHeads = readAlembicHeads(config.installDir, COMMUNITY_LAYOUT)

    // Resolve the target image tag
    let targetImage: string
    if (targetVersion) {
      s.start(`Checking if v${targetVersion} exists`)
      const exists = await resolveTag(targetVersion)
      if (!exists) {
        // Also try with 'v' prefix
        const existsWithV = await resolveTag(`v${targetVersion}`)
        if (!existsWithV) {
          s.stop('Version not found')
          p.log.error(
            `Version ${targetVersion} not found on ghcr.io/learnhouse/app`,
          )
          process.exit(1)
        }
        targetImage = `${GHCR_BASE}:v${targetVersion}`
      } else {
        targetImage = `${GHCR_BASE}:${targetVersion}`
      }
      s.stop(`Found v${targetVersion}`)
    } else {
      // Follow the install's channel: dev stays on :dev, stable moves to the
      // newest versioned release (falling back to :latest).
      // Configs written before 1.6.0 have no channel; their compose image says it.
      const channel = config.channel ?? (/learnhouse\/app:dev\s*$/m.test(originalCompose) ? 'dev' : 'stable')
      targetImage = (await resolveAppImage(channel)).image
    }

    // Preserve any uploaded media before the container is ever recreated. The
    // app is stopped first so nothing is uploaded into the old container after
    // the copy. A failure here aborts: recreating the container would delete
    // the only copy of the uploads.
    s.start('Checking content storage')
    try {
      const migration = migrateContentVolume(config.installDir, config.deploymentId, () => {
        appStopped = true
        dockerComposeStop(config.installDir, COMMUNITY_LAYOUT.appService)
      })
      switch (migration.status) {
        case 'migrated':
          s.stop(
            `Migrated uploaded content into persistent volume (${formatBytes(migration.copiedBytes ?? 0)})`,
          )
          break
        case 'patched_no_data':
          s.stop('Added persistent content volume to docker-compose.yml')
          break
        case 'already_mounted':
          s.stop('Content storage already persistent')
          break
        case 'skipped_s3':
          s.stop('Content served from S3; no local volume needed')
          break
        case 'no_compose':
          s.stop('Skipped content migration (no docker-compose.yml found)')
          break
      }
    } catch (err) {
      s.stop('Content migration failed')
      const msg = err instanceof Error ? err.message : String(err)
      p.log.error(`Could not move uploaded content into a persistent volume: ${msg}`)
      p.log.error('Aborting before the app container is recreated, so no uploads are lost. Nothing was updated.')
      try { dockerComposeUp(config.installDir) } catch { /* reported by docker */ }
      process.exit(1)
    }

    // Point compose at the new image and pull it. The compose file is restored
    // on any failure below, so a later `start` never boots an unpulled or
    // un-migrated image.
    const composeContent = readFileSync(composePath, 'utf-8')
    rollbackCompose = composeContent
    writeFileAtomic(composePath, replaceComposeImageTag(composeContent, targetImage))

    s.start('Pulling new image (this may take a minute)')
    dockerComposePull(config.installDir)
    s.stop('Image pulled')

    // 3) Migrate with the new image before it boots. The new image cannot start
    //    against an un-migrated schema, so this has to happen before the
    //    restart, not after it. Only the app is stopped first: its open
    //    connections would otherwise block the ALTER TABLE locks indefinitely.
    //    db, redis and the proxy keep running.
    if (options.migrate !== false) {
      p.log.step('Running database migrations')
      appStopped = true
      dockerComposeStop(config.installDir, COMMUNITY_LAYOUT.appService)
      if (!migrateBeforeBoot(config.installDir, COMMUNITY_LAYOUT, previousHeads, ui)) {
        writeFileAtomic(composePath, composeContent)
        rollbackCompose = null
        dockerComposeUp(config.installDir)
        appStopped = false
        p.log.warn('The previous version has been started again.')
        process.exit(1)
      }
      // The schema now matches the new image: going back to the old one is no
      // longer a safe rollback (restore the backup for that).
      rollbackCompose = null
    }

    // `up -d` recreates only what changed; everything was pulled above, so no
    // registry round-trip can fail between stopping and starting.
    s.start('Restarting services')
    dockerComposeUp(config.installDir)
    rollbackCompose = null
    appStopped = false
    s.stop('Services restarted')

    // 4) Wait for the app, then run migrations via the shared helper.
    s.start('Waiting for LearnHouse to be ready')
    const healthy = await waitForAppHealth(config)
    if (healthy) {
      s.stop('LearnHouse is up')
    } else {
      s.stop('LearnHouse did not become healthy')
      p.log.warn('Check `npx learnhouse logs`. Your DB backup is in ./backups/.')
    }

    if (options.migrate !== false) {
      // Normally a no-op after the pre-start run; catches anything the new
      // image's startup created that still needs a migration.
      p.log.step('Verifying database migrations')
      if (!runAlembicUpgrade(config.installDir, COMMUNITY_LAYOUT, ui, previousHeads)) {
        p.log.warn('Your DB backup is in ./backups/; restore it and re-pin the previous image to roll back.')
        process.exit(1)
      }
    } else {
      p.log.info('Skipped migrations (--no-migrate). Run later:')
      p.log.info('  docker compose exec learnhouse-app sh -c "cd /app/api && uv run alembic upgrade head"')
    }

    if (!healthy) process.exit(1)

    if (targetVersion) {
      p.log.success(`LearnHouse has been updated to v${targetVersion}!`)
    } else {
      p.log.success('LearnHouse has been updated to the latest version!')
    }
  } catch (err) {
    s.stop('Update failed')
    const detail = (err as { message?: string })?.message ?? String(err)
    p.log.error(`Failed to update: ${detail}`)
    if (rollbackCompose !== null) {
      try {
        writeFileAtomic(composePath, rollbackCompose)
        p.log.info('docker-compose.yml was restored to the previous image.')
      } catch { /* leave as-is; message above says what failed */ }
    }
    if (appStopped) {
      // Never leave the site down because an update step failed.
      try {
        dockerComposeUp(config.installDir)
        p.log.info('Services were started again.')
      } catch { /* reported by docker */ }
    }
    process.exit(1)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
