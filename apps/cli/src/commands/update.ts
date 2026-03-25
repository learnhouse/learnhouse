import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeDown, dockerComposeUp } from '../services/docker.js'

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

export async function updateCommand(options: { version?: string }) {
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

    s.start('Restarting services')
    dockerComposeDown(config.installDir)
    dockerComposeUp(config.installDir)
    s.stop('Services restarted')

    // Ask user about database migrations
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

    if (p.isCancel(runMigrations)) {
      p.log.info('Skipped database migrations. You can run them later with:')
      p.log.info('  docker exec <container> sh -c "cd /app/api && uv run alembic upgrade head"')
    } else if (runMigrations) {
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
      } catch {
        s.stop('Migration warning')
        p.log.warn('Database migrations encountered an issue. Your app is running but you may need to run migrations manually:')
        p.log.warn('  docker exec <container> sh -c "cd /app/api && uv run alembic upgrade head"')
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
