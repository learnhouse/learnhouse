import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ContentMigrationStatus =
  | 'already_mounted'
  | 'skipped_s3'
  | 'no_compose'
  | 'patched_no_data'
  | 'migrated'

export interface ContentMigrationResult {
  status: ContentMigrationStatus
  copiedBytes?: number
}

const CONTENT_PATH = '/app/api/content'

export function migrateContentVolume(
  installDir: string,
  deploymentId: string,
): ContentMigrationResult {
  const composePath = path.join(installDir, 'docker-compose.yml')
  if (!fs.existsSync(composePath)) return { status: 'no_compose' }

  let compose = fs.readFileSync(composePath, 'utf-8')
  if (compose.includes(CONTENT_PATH)) return { status: 'already_mounted' }

  const envPath = path.join(installDir, '.env')
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8')
    if (/^LEARNHOUSE_CONTENT_DELIVERY_TYPE\s*=\s*s3api\s*$/m.test(env)) {
      return { status: 'skipped_s3' }
    }
  }

  const projectName =
    compose.match(/^name:\s*(\S+)/m)?.[1] ?? `learnhouse-${deploymentId}`
  const volumeFull = `${projectName}_learnhouse_content_${deploymentId}`
  const containerName = `learnhouse-app-${deploymentId}`

  let copiedBytes = 0
  const hasContainer = dockerContainerExists(containerName)
  if (hasContainer) {
    copiedBytes = copyContainerContentIntoVolume(containerName, volumeFull)
  }

  compose = patchComposeAddContentVolume(compose, deploymentId)
  fs.writeFileSync(composePath, compose)

  return hasContainer
    ? { status: 'migrated', copiedBytes }
    : { status: 'patched_no_data' }
}

function dockerContainerExists(name: string): boolean {
  try {
    execFileSync('docker', ['inspect', name], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function copyContainerContentIntoVolume(
  containerName: string,
  volumeFull: string,
): number {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-content-'))
  const helperName = `lh-content-migrate-${Date.now()}`
  try {
    execFileSync(
      'docker',
      ['cp', `${containerName}:${CONTENT_PATH}/.`, `${tmpDir}/`],
      { stdio: 'pipe' },
    )

    // `docker run -v <named-vol>` lazily creates the volume — avoids the
    // "volume not created by Docker Compose" warning on the next compose up.
    execFileSync(
      'docker',
      [
        'run', '--name', helperName, '-d',
        '-v', `${volumeFull}:/dst`,
        'alpine', 'sh', '-c', 'sleep 60',
      ],
      { stdio: 'pipe' },
    )
    try {
      execFileSync(
        'docker',
        ['cp', `${tmpDir}/.`, `${helperName}:/dst/`],
        { stdio: 'pipe' },
      )
    } finally {
      try {
        execFileSync('docker', ['rm', '-f', helperName], { stdio: 'pipe' })
      } catch {}
    }

    return directorySize(tmpDir)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function patchComposeAddContentVolume(
  compose: string,
  deploymentId: string,
): string {
  const mountLine = `      - learnhouse_content_${deploymentId}:${CONTENT_PATH}`

  const appStart = compose.indexOf('learnhouse-app:')
  if (appStart === -1) {
    throw new Error('learnhouse-app service not found in docker-compose.yml')
  }
  const networksIdx = compose.indexOf('\n    networks:', appStart)
  if (networksIdx === -1) {
    throw new Error('No service-level networks: block under learnhouse-app')
  }

  const appBody = compose.slice(appStart, networksIdx)
  if (/\n    volumes:/.test(appBody)) {
    const volumesIdx = compose.indexOf('\n    volumes:', appStart)
    const insertAt = volumesIdx + '\n    volumes:'.length
    if (!compose.slice(insertAt, networksIdx).includes(mountLine)) {
      compose = compose.slice(0, insertAt) + '\n' + mountLine + compose.slice(insertAt)
    }
  } else {
    const block = `    volumes:\n${mountLine}\n`
    compose = compose.slice(0, networksIdx + 1) + block + compose.slice(networksIdx + 1)
  }

  const volumeEntry = `  learnhouse_content_${deploymentId}:`
  if (/^volumes:\s*$/m.test(compose) || /^volumes:\s*\n/m.test(compose)) {
    if (!compose.includes(volumeEntry)) {
      compose = compose.replace(/\s*$/, '') + `\n${volumeEntry}\n`
    }
  } else {
    compose = compose.replace(/\s*$/, '') + `\n\nvolumes:\n${volumeEntry}\n`
  }

  return compose
}

function directorySize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += directorySize(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}
