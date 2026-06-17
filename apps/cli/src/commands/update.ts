import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeDown, dockerComposeUp, dockerComposePull } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'
import { waitForHealth } from '../services/health.js'
import {
  updateEnterprise,
  backupDatabase,
  ensureAlembicBaseline,
  runAlembicUpgrade,
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
      `https://ghcr.io/v2/learnhouse/app/manifests/${version}`,
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

  const targetVersion = options.version?.replace(/^v/, '')

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
  const s = p.spinner()
  try {
    // 1) Back up the database first (safety net for migrations) — works for the
    //    in-container db AND an external one via the .env string.
    if (options.backup !== false) {
      s.start('Backing up the database')
      try {
        const b = backupDatabase(config, COMMUNITY_LAYOUT, ui)
        s.stop('Database backed up')
        ui.ok(`Backup: ${b}`)
      } catch (err) {
        s.stop('Backup failed')
        p.log.error(`Database backup failed: ${(err as Error)?.message ?? err}. Aborting — nothing changed.`)
        process.exit(1)
      }
    } else {
      p.log.warn('Skipping database backup (--no-backup). Not recommended for production.')
    }
    // 2) Stamp an Alembic baseline if the DB was created via create_all and never stamped.
    ensureAlembicBaseline(config.installDir, COMMUNITY_LAYOUT, ui)

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
      targetImage = `${GHCR_BASE}:latest`
    }

    // Update the image in docker-compose.yml
    const composePath = join(config.installDir, 'docker-compose.yml')
    const composeContent = readFileSync(composePath, 'utf-8')
    const updatedCompose = composeContent.replace(
      /image:\s*ghcr\.io\/learnhouse\/app:\S+/,
      `image: ${targetImage}`,
    )
    writeFileSync(composePath, updatedCompose)

    s.start('Pulling image')
    dockerComposePull(config.installDir)
    s.stop('Image pulled')

    // Preserve any uploaded media before the container is recreated.
    s.start('Checking content storage')
    try {
      const migration = migrateContentVolume(config.installDir, config.deploymentId)
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
          s.stop('Content served from S3 — no local volume needed')
          break
        case 'no_compose':
          s.stop('Skipped content migration (no docker-compose.yml found)')
          break
      }
    } catch (err) {
      s.stop('Content migration failed')
      const msg = err instanceof Error ? err.message : String(err)
      p.log.warn(`Could not migrate uploaded content: ${msg}`)
    }

    s.start('Restarting services')
    dockerComposeDown(config.installDir)
    dockerComposeUp(config.installDir, false, true)
    s.stop('Services restarted')

    // 4) Wait for the app, then run migrations via the shared helper.
    s.start('Waiting for LearnHouse to be ready')
    await waitForHealth(`http://localhost:${config.httpPort}`)
    s.stop('LearnHouse is up')

    if (options.migrate !== false) {
      p.log.step('Running database migrations')
      if (!runAlembicUpgrade(config.installDir, COMMUNITY_LAYOUT, ui)) {
        p.log.warn('Your DB backup is in ./backups/ — restore it and re-pin the previous image to roll back.')
        process.exit(1)
      }
    } else {
      p.log.info('Skipped migrations (--no-migrate). Run later:')
      p.log.info('  docker compose exec learnhouse-app sh -c "cd /app/api && uv run alembic upgrade head"')
    }

    if (targetVersion) {
      p.log.success(`LearnHouse has been updated to v${targetVersion}!`)
    } else {
      p.log.success('LearnHouse has been updated to the latest version!')
    }
  } catch {
    s.stop('Update failed')
    p.log.error('Failed to update. Check Docker output above.')
    process.exit(1)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

