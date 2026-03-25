import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import {
  autoDetectDeploymentId,
  isDockerInstalled,
  isDockerRunning,
  isContainerRunning,
  getContainerRestartCount,
  getContainerLogs,
  getDockerDiskUsage,
  listDeploymentContainers,
} from '../services/docker.js'
import { checkPort } from '../utils/network.js'

function pass(msg: string) { console.log(`  ${pc.green('✓')} ${msg}`) }
function warn(msg: string, fix?: string) {
  console.log(`  ${pc.yellow('!')} ${msg}`)
  if (fix) console.log(`    ${pc.dim(`Fix: ${fix}`)}`)
}
function fail(msg: string, fix?: string) {
  console.log(`  ${pc.red('✗')} ${msg}`)
  if (fix) console.log(`    ${pc.dim(`Fix: ${fix}`)}`)
}

const REQUIRED_ENV_VARS = [
  'LEARNHOUSE_DOMAIN',
  'LEARNHOUSE_SQL_CONNECTION_STRING',
  'LEARNHOUSE_REDIS_CONNECTION_STRING',
  'LEARNHOUSE_AUTH_JWT_SECRET_KEY',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
]

const SECRET_ENV_VARS = [
  'LEARNHOUSE_AUTH_JWT_SECRET_KEY',
  'NEXTAUTH_SECRET',
  'POSTGRES_PASSWORD',
]

export async function doctorCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)

  p.intro(pc.cyan('LearnHouse Doctor'))

  // 1. Docker daemon
  p.log.step('Docker Environment')
  if (!isDockerInstalled()) {
    fail('Docker not installed', 'Install Docker: https://docs.docker.com/get-docker/')
    p.outro(pc.red('Cannot continue without Docker'))
    process.exit(1)
  }
  pass('Docker installed')

  if (!isDockerRunning()) {
    fail('Docker daemon not running', 'Start Docker Desktop or run: sudo systemctl start docker')
    p.outro(pc.red('Cannot continue without Docker running'))
    process.exit(1)
  }
  pass('Docker daemon running')

  if (!config) {
    p.log.warn('No LearnHouse installation found. Skipping deployment checks.')
    p.outro(pc.dim('Done'))
    return
  }

  const id = config.deploymentId || autoDetectDeploymentId()
  const installDir = dir // use the directory where config was found

  if (!id) {
    p.log.warn('No deployment ID found. Skipping container checks.')
    p.outro(pc.dim('Done'))
    return
  }

  // 3. Container status
  p.log.step('Containers')
  const containers = listDeploymentContainers(id)
  if (containers.length === 0) {
    warn('No containers found', 'Run: npx learnhouse start')
  } else {
    for (const c of containers) {
      const isUp = c.status.toLowerCase().startsWith('up')
      const svcName = c.name.replace(`-${id}`, '')
      if (isUp) {
        pass(`${svcName} running`)
      } else if (c.status.toLowerCase().includes('restarting')) {
        fail(`${svcName} is restarting`, 'Check logs: npx learnhouse logs')
      } else {
        fail(`${svcName} — ${c.status}`, 'Run: npx learnhouse start')
      }
    }
  }

  // 4. Restart counts
  p.log.step('Restart Counts')
  for (const c of containers) {
    const count = getContainerRestartCount(c.name)
    const svcName = c.name.replace(`-${id}`, '')
    if (count > 3) {
      warn(`${svcName} has restarted ${count} times`, 'Check container logs for crash reasons')
    } else {
      pass(`${svcName} — ${count} restarts`)
    }
  }

  // 5. Port availability
  p.log.step('Network')
  const portFree = await checkPort(config.httpPort)
  if (portFree) {
    pass(`Port ${config.httpPort} is available`)
  } else {
    // Port in use is expected if services are running
    const hasRunning = containers.some((c) => c.status.toLowerCase().startsWith('up'))
    if (hasRunning) {
      pass(`Port ${config.httpPort} in use (by LearnHouse services)`)
    } else {
      warn(`Port ${config.httpPort} is in use by another process`, `Free the port or change HTTP_PORT in .env`)
    }
  }

  // 6. DNS resolution
  if (config.domain !== 'localhost' && !config.domain.startsWith('127.')) {
    try {
      const { promises: dns } = await import('node:dns')
      await dns.resolve(config.domain)
      pass(`DNS resolves for ${config.domain}`)
    } catch {
      warn(`DNS resolution failed for ${config.domain}`, 'Check your DNS settings or /etc/hosts')
    }
  }

  // 7. Disk space
  p.log.step('Disk')
  try {
    const dfOutput = execSync("df -h . | tail -1 | awk '{print $4}'", {
      stdio: 'pipe',
      cwd: installDir,
    }).toString().trim()
    const sizeStr = dfOutput.toLowerCase()
    // Parse available space — warn if under 1G
    const numericVal = parseFloat(sizeStr)
    if (sizeStr.includes('g') && numericVal < 1) {
      warn(`Low disk space: ${dfOutput} available`, 'Free up disk space or docker system prune')
    } else if (sizeStr.includes('m')) {
      warn(`Low disk space: ${dfOutput} available`, 'Free up disk space or docker system prune')
    } else {
      pass(`Disk space available: ${dfOutput}`)
    }
  } catch {
    warn('Could not check disk space')
  }

  // 8. Docker volume sizes
  try {
    const diskUsage = getDockerDiskUsage()
    p.log.message(pc.dim(diskUsage.trim()))
  } catch { /* ignore */ }

  // 9. Log scanning
  p.log.step('Log Analysis')
  const errorPatterns = /ERROR|FATAL|Traceback/i
  for (const c of containers) {
    if (!isContainerRunning(c.name)) continue
    try {
      const logs = getContainerLogs(c.name, 50)
      const errorLines = logs.split('\n').filter((l) => errorPatterns.test(l))
      const svcName = c.name.replace(`-${id}`, '')
      if (errorLines.length > 0) {
        warn(`${svcName} — ${errorLines.length} error(s) in last 50 log lines`)
        // Show first 3 errors
        for (const line of errorLines.slice(0, 3)) {
          console.log(`    ${pc.dim(line.trim().slice(0, 120))}`)
        }
      } else {
        pass(`${svcName} — no errors in recent logs`)
      }
    } catch {
      warn(`Could not read logs for ${c.name}`)
    }
  }

  // 10. .env validation
  p.log.step('Environment File')
  const envPath = path.join(installDir, '.env')
  if (!fs.existsSync(envPath)) {
    fail('.env file missing', 'Run setup again: npx learnhouse setup')
  } else {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const envMap = new Map<string, string>()
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      envMap.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1))
    }

    let envOk = true
    for (const key of REQUIRED_ENV_VARS) {
      if (!envMap.has(key) || !envMap.get(key)) {
        fail(`Missing or empty: ${key}`)
        envOk = false
      }
    }

    for (const key of SECRET_ENV_VARS) {
      const val = envMap.get(key) || ''
      if (val && val.length < 8) {
        warn(`${key} seems too short (${val.length} chars)`, 'Use a stronger secret')
        envOk = false
      }
    }

    if (envOk) {
      pass('All required environment variables present')
    }
  }

  // 11. Image freshness
  p.log.step('Image Freshness')
  for (const c of containers) {
    try {
      const localDigest = execSync(
        `docker inspect --format '{{.Image}}' ${c.name}`,
        { stdio: 'pipe' },
      ).toString().trim()
      const svcName = c.name.replace(`-${id}`, '')
      pass(`${svcName} — image: ${localDigest.slice(7, 19)}`)
    } catch {
      // Skip
    }
  }

  console.log()
  p.outro(pc.dim('Diagnosis complete'))
}
