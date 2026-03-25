import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import {
  autoDetectDeploymentId,
  dockerExec,
  dockerStats,
  dockerStatsForContainers,
  getDockerDiskUsage,
  isContainerRunning,
  listDeploymentContainers,
} from '../services/docker.js'

function pass(msg: string): string { return `${pc.green('●')} ${msg}` }
function fail(msg: string): string { return `${pc.red('●')} ${msg}` }

export async function healthCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Health Check'))

  const id = config.deploymentId || autoDetectDeploymentId()
  if (!id) {
    p.log.error('No deployment found. Start services first.')
    process.exit(1)
  }

  // 1. Container status
  p.log.step('Container Status')
  const containers = listDeploymentContainers(id)
  if (containers.length === 0) {
    p.log.message(fail('No containers found. Are services running?'))
  } else {
    for (const c of containers) {
      const isUp = c.status.toLowerCase().startsWith('up')
      const svcName = c.name.replace(`-${id}`, '')
      p.log.message(isUp ? pass(`${svcName} — ${c.status}`) : fail(`${svcName} — ${c.status}`))
    }
  }

  // 2. Database connection
  p.log.step('Database')
  const dbContainer = `learnhouse-db-${id}`
  if (isContainerRunning(dbContainer)) {
    try {
      dockerExec(dbContainer, 'pg_isready -U learnhouse')
      p.log.message(pass('PostgreSQL accepting connections'))
    } catch {
      p.log.message(fail('PostgreSQL not ready'))
    }
  } else {
    p.log.message(fail('Database container not running'))
  }

  // 3. Redis ping
  p.log.step('Redis')
  const redisContainer = `learnhouse-redis-${id}`
  if (isContainerRunning(redisContainer)) {
    try {
      const pong = dockerExec(redisContainer, 'redis-cli ping')
      p.log.message(pong === 'PONG' ? pass('Redis responding') : fail(`Redis returned: ${pong}`))
    } catch {
      p.log.message(fail('Redis not responding'))
    }
  } else {
    p.log.message(fail('Redis container not running'))
  }

  // 4. HTTP endpoint
  p.log.step('HTTP Endpoint')
  const protocol = config.useHttps ? 'https' : 'http'
  const portSuffix = (config.useHttps && config.httpPort === 443) || (!config.useHttps && config.httpPort === 80) ? '' : `:${config.httpPort}`
  const healthUrl = `${protocol}://${config.domain}${portSuffix}/api/v1/health`
  try {
    const start = Date.now()
    const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) })
    const elapsed = Date.now() - start
    if (resp.ok) {
      p.log.message(pass(`${healthUrl} — ${resp.status} (${elapsed}ms)`))
    } else {
      p.log.message(fail(`${healthUrl} — ${resp.status} (${elapsed}ms)`))
    }
  } catch (err: any) {
    p.log.message(fail(`${healthUrl} — ${err.message || 'unreachable'}`))
  }

  // 5. Disk usage
  p.log.step('Disk Usage')
  try {
    const diskOutput = getDockerDiskUsage()
    p.log.message(pc.dim(diskOutput.trim()))
  } catch {
    p.log.message(fail('Could not retrieve disk usage'))
  }

  // 6. Resource usage
  p.log.step('Resource Usage')
  try {
    const stats = dockerStats(config.installDir)
    p.log.message(pc.dim(stats.trim()))
  } catch {
    // Fallback: use docker stats directly with container names
    try {
      const names = containers.filter((c) => c.status.toLowerCase().startsWith('up')).map((c) => c.name)
      if (names.length > 0) {
        const stats = dockerStatsForContainers(names)
        p.log.message(pc.dim(stats.trim()))
      } else {
        p.log.message(fail('No running containers to get stats from'))
      }
    } catch {
      p.log.message(fail('Could not retrieve resource stats'))
    }
  }

  p.outro(pc.dim('Health check complete'))
}
