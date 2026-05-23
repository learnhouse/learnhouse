import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeDown, dockerComposeUp } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'

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

export async function updateCommand(options: { version?: string; migrate?: boolean }) {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run `npx learnhouse setup` first.')
    process.exit(1)
  }

  const targetVersion = options.version?.replace(/^v/, '')

  if (targetVersion) {
    p.intro(pc.cyan(`Updating LearnHouse to v${targetVersion}`))
  } else {
    p.intro(pc.cyan('Updating LearnHouse to latest'))
  }

  const s = p.spinner()
  try {
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
    // docker compose up with --pull always handles the pull
    s.stop('Image reference updated')

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
    dockerComposeUp(config.installDir)
    s.stop('Services restarted')

    // Database migrations
    let shouldMigrate: boolean
    if (options.migrate === true) {
      shouldMigrate = true
    } else if (options.migrate === false) {
      shouldMigrate = false
    } else {
      // Interactive — ask the user
      p.log.info('')
      p.log.warn(
        pc.bold('This update may include database migrations.'),
      )
      p.log.info(
        `Before proceeding, check the release notes at ${pc.cyan('https://docs.learnhouse.app')} for migration guides and breaking changes.`,
      )
      p.log.info('')

      const runMigrations = await p.confirm({
        message: 'Run database migrations now?',
        initialValue: false,
      })
      shouldMigrate = !p.isCancel(runMigrations) && !!runMigrations
    }

    if (shouldMigrate) {
      s.start('Running database migrations')
      try {
        const appContainer = getAppContainerName(config.installDir)
        if (appContainer) {
          waitForContainer(appContainer)
          execSync(
            `docker exec ${appContainer} sh -c "cd /app/api && uv run alembic upgrade head"`,
            { stdio: 'pipe', timeout: 120_000 },
          )
          s.stop('Database migrations complete')
        } else {
          s.stop('Skipped migrations (container not found)')
          p.log.warn('Could not find the app container to run migrations. Run them manually:')
          p.log.warn('  docker exec <container> sh -c "cd /app/api && uv run alembic upgrade head"')
        }
      } catch (err: unknown) {
        s.stop('Database migrations failed')
        const stderr =
          (err as { stderr?: Buffer | string })?.stderr?.toString?.() ?? ''
        const stdout =
          (err as { stdout?: Buffer | string })?.stdout?.toString?.() ?? ''
        const output = (stderr || stdout).trim()
        if (output) {
          for (const line of output.split('\n')) p.log.error(`  ${line}`)
        }
        const container = getAppContainerName(config.installDir) ?? '<container>'
        p.log.warn('Retry manually with:')
        p.log.warn(
          `  docker exec ${container} sh -c "cd /app/api && uv run alembic upgrade head"`,
        )
      }
    } else {
      p.log.info('Skipped database migrations. You can run them later with:')
      p.log.info('  docker exec <container> sh -c "cd /app/api && uv run alembic upgrade head"')
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

function getAppContainerName(cwd: string): string | null {
  try {
    const output = execSync('docker compose ps --format "{{.Name}}"', {
      cwd,
      stdio: 'pipe',
    }).toString().trim()
    const lines = output.split('\n')
    return lines.find((name) => name.includes('learnhouse-app-')) || null
  } catch {
    return null
  }
}

function waitForContainer(containerName: string, timeoutMs = 60_000): void {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const status = execSync(
        `docker inspect -f '{{.State.Health.Status}}' ${containerName}`,
        { stdio: 'pipe' },
      ).toString().trim()
      if (status === 'healthy') return
    } catch {
      // Container may not have health check — check if running
      try {
        const running = execSync(
          `docker inspect -f '{{.State.Running}}' ${containerName}`,
          { stdio: 'pipe' },
        ).toString().trim()
        if (running === 'true') return
      } catch {
        // not ready yet
      }
    }
    execSync('sleep 2', { stdio: 'pipe' })
  }
}
