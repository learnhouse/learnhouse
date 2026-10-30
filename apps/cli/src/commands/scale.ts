import fs from 'node:fs'
import path from 'node:path'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { autoDetectDeploymentId, dockerComposeUp, dockerStats, dockerStatsForContainers, listDeploymentContainers } from '../services/docker.js'
import { migrateContentVolume } from '../services/content-volume-migration.js'
import { hasComposeService, stackLayout } from '../services/stack.js'
import type { LearnHouseConfigJson } from '../types.js'

export function parseMemLimit(composePath: string): Map<string, string> {
  const content = fs.readFileSync(composePath, 'utf-8')
  const limits = new Map<string, string>()
  let currentService: string | null = null
  let inServices = false

  for (const line of content.split('\n')) {
    if (line.match(/^services:\s*$/)) {
      inServices = true
      continue
    }
    if (line.match(/^\S/)) inServices = false
    if (inServices && line.match(/^  \w/) && line.includes(':')) {
      const match = line.match(/^\s{2}(\S+):/)
      currentService = match ? match[1] : null
    }
    if (inServices && currentService && line.match(/^\s+mem_limit:/)) {
      const value = line.split(':')[1].trim()
      limits.set(currentService, value)
    }
  }

  return limits
}

/**
 * Set `mem_limit` on one service. Replaces an existing limit wherever it sits
 * in the service block; otherwise inserts one after `container_name`
 * (Community) or directly under the service header (Enterprise services have
 * no container_name).
 */
export function setMemLimit(content: string, service: string, limit: string): string {
  const lines = content.split('\n')

  // Locate the service block: from its header to the next service or top-level key.
  let inServices = false
  let header = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^services:\s*$/.test(line)) { inServices = true; continue }
    if (!inServices) continue
    if (/^\S/.test(line)) { if (header >= 0) { end = i; break } inServices = false; continue }
    const m = line.match(/^  (\S+):/)
    if (m) {
      if (header >= 0) { end = i; break }
      if (m[1] === service) header = i
    }
  }
  if (header < 0) return content

  const indent = '    '
  const block = lines.slice(header + 1, end)
  const existing = block.findIndex((l) => /^\s+mem_limit:/.test(l))
  if (existing >= 0) {
    lines[header + 1 + existing] = lines[header + 1 + existing].replace(/mem_limit:.*/, `mem_limit: ${limit}`)
    return lines.join('\n')
  }
  const containerName = block.findIndex((l) => /^\s+container_name:/.test(l))
  const at = containerName >= 0 ? header + 1 + containerName + 1 : header + 1
  lines.splice(at, 0, `${indent}mem_limit: ${limit}`)
  return lines.join('\n')
}

/**
 * Prompt for memory limits on the install's services and apply them. Shared
 * by `learnhouse scale` and the `deployments` menu.
 */
export async function scaleResources(config: LearnHouseConfigJson): Promise<void> {
  // Show current usage
  p.log.step('Current Resource Usage')
  try {
    const stats = dockerStats(config.installDir)
    p.log.message(pc.dim(stats.trim()))
  } catch {
    try {
      const id = config.deploymentId || autoDetectDeploymentId()
      const running = listDeploymentContainers(id || undefined)
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

  const originalContent = fs.readFileSync(composePath, 'utf-8')
  let composeContent = originalContent
  const currentLimits = parseMemLimit(composePath)
  const services = stackLayout(config).scalableServices.filter((svc) => hasComposeService(config.installDir, svc))

  // Prompt for each service
  p.log.step('Set Memory Limits')
  p.log.info(pc.dim('Examples: 256m, 512m, 1g, 2g (leave empty to skip)'))

  for (const service of services) {
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
      p.log.success(`${service}: ${trimmed}`)
    } else if (trimmed) {
      p.log.warn(`Invalid format "${trimmed}", skipping. Use format like 512m or 1g.`)
    }
  }

  if (composeContent === originalContent) {
    p.log.info('No changes made.')
    return
  }

  fs.writeFileSync(composePath, composeContent)
  p.log.success('docker-compose.yml updated')

  const restart = await p.confirm({
    message: 'Restart services to apply limits?',
    initialValue: false,
  })
  if (!p.isCancel(restart) && restart) {
    await applyComposeChanges(config)
  }
}

/**
 * Recreate the containers whose compose definition changed (`up -d`; no
 * `down`, so nothing else restarts). On Community installs from before the
 * content volume existed, uploads live in the app container itself, so they
 * are moved into the volume first; recreating without that would delete them.
 */
export async function applyComposeChanges(config: LearnHouseConfigJson): Promise<boolean> {
  const s = p.spinner()
  s.start('Applying changes')
  try {
    if (config.edition !== 'enterprise') migrateContentVolume(config.installDir, config.deploymentId)
  } catch (err) {
    s.stop('Not restarted')
    p.log.error(`Could not move uploaded content into a persistent volume first: ${(err as Error)?.message ?? err}`)
    p.log.info('Your changes are saved; restart later with `npx learnhouse start`.')
    process.exitCode = 1
    return false
  }
  try {
    dockerComposeUp(config.installDir)
    s.stop('Changes applied')
    return true
  } catch {
    s.stop('Restart failed')
    p.log.error('Failed to restart services. Check Docker output above.')
    process.exitCode = 1
    return false
  }
}

export async function scaleCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  p.intro(pc.cyan('LearnHouse Resource Limits'))
  await scaleResources(config)
  p.outro(pc.dim('Done'))
}
