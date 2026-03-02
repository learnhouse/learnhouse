import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { dockerComposeDown, dockerComposeUp, dockerStats, dockerStatsForContainers, listDeploymentContainers } from '../services/docker.js'

const SERVICES = ['learnhouse-app', 'db', 'redis'] as const

function parseMemLimit(composePath: string): Map<string, string> {
  const content = fs.readFileSync(composePath, 'utf-8')
  const limits = new Map<string, string>()
  let currentService: string | null = null
  let inServices = false

  for (const line of content.split('\n')) {
    if (line.match(/^services:\s*$/)) {
      inServices = true
      continue
    }
    if (inServices && line.match(/^  \w/) && line.includes(':')) {
      const match = line.match(/^\s{2}(\S+):/)
      currentService = match ? match[1] : null
    }
    if (currentService && line.match(/^\s+mem_limit:/)) {
      const value = line.split(':')[1].trim()
      limits.set(currentService, value)
    }
  }

  return limits
}

function setMemLimit(content: string, service: string, limit: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let currentService: string | null = null
  let inServices = false
  let serviceIndent = 0
  let insertedForService = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.match(/^services:\s*$/)) {
      inServices = true
      result.push(line)
      continue
    }

    if (inServices && line.match(/^  \w/) && line.includes(':')) {
      const match = line.match(/^(\s{2})(\S+):/)
      if (match) {
        currentService = match[2]
        serviceIndent = match[1].length
        insertedForService = false
      }
    }

    if (currentService === service && line.match(/^\s+mem_limit:/)) {
      // Replace existing mem_limit
      result.push(line.replace(/mem_limit:.*/, `mem_limit: ${limit}`))
      insertedForService = true
      continue
    }

    // Insert mem_limit after container_name if not already present
    if (currentService === service && !insertedForService && line.match(/^\s+container_name:/)) {
      result.push(line)
      result.push(`${' '.repeat(serviceIndent + 2)}mem_limit: ${limit}`)
      insertedForService = true
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

export async function scaleCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Resource Limits'))

  // Show current usage
  p.log.step('Current Resource Usage')
  try {
    const stats = dockerStats(config.installDir)
    p.log.message(pc.dim(stats.trim()))
  } catch {
    try {
      const running = listDeploymentContainers(config.deploymentId)
        .filter((c) => c.status.toLowerCase().startsWith('up'))
        .map((c) => c.name)
      if (running.length > 0) {
        const stats = dockerStatsForContainers(running)
        p.log.message(pc.dim(stats.trim()))
      } else {
        p.log.warn('No running containers found.')
      }
    } catch {
      p.log.warn('Could not retrieve current stats. Services may not be running.')
    }
  }

  const composePath = path.join(config.installDir, 'docker-compose.yml')
  if (!fs.existsSync(composePath)) {
    p.log.error('docker-compose.yml not found.')
    process.exit(1)
  }

  let composeContent = fs.readFileSync(composePath, 'utf-8')
  const currentLimits = parseMemLimit(composePath)

  // Prompt for each service
  p.log.step('Set Memory Limits')
  p.log.info(pc.dim('Examples: 256m, 512m, 1g, 2g (leave empty to skip)'))

  let changed = false

  for (const service of SERVICES) {
    const current = currentLimits.get(service)
    const label = current
      ? `Memory limit for ${pc.bold(service)} (current: ${current})`
      : `Memory limit for ${pc.bold(service)} (not set)`

    const value = await p.text({
      message: label,
      placeholder: current ? undefined : 'e.g. 512m',
      defaultValue: current || '',
    })
    if (p.isCancel(value)) { p.cancel(); process.exit(0) }

    const trimmed = (value as string).trim()
    if (trimmed && trimmed.match(/^\d+[mgMG]$/)) {
      composeContent = setMemLimit(composeContent, service, trimmed)
      changed = true
      p.log.success(`${service}: ${trimmed}`)
    } else if (trimmed) {
      p.log.warn(`Invalid format "${trimmed}" — skipping. Use format like 512m or 1g.`)
    }
  }

  if (!changed) {
    p.log.info('No changes made.')
    p.outro(pc.dim('Done'))
    return
  }

  fs.writeFileSync(composePath, composeContent)
  p.log.success('docker-compose.yml updated')

  const restart = await p.confirm({
    message: 'Restart services to apply limits?',
    initialValue: false,
  })
  if (!p.isCancel(restart) && restart) {
    const s = p.spinner()
    s.start('Restarting services')
    try {
      dockerComposeDown(config.installDir)
      dockerComposeUp(config.installDir)
      s.stop('Services restarted')
    } catch {
      s.stop('Restart failed')
      p.log.error('Failed to restart services. Check Docker output above.')
    }
  }

  p.outro(pc.dim('Done'))
}
