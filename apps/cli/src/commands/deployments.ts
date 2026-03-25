import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { autoDetectDeploymentId, dockerComposeDown, dockerComposeUp, dockerStats, dockerStatsForContainers, listDeploymentContainers } from '../services/docker.js'

interface Deployment {
  id: string
  containers: { name: string; status: string; image: string }[]
}

const SERVICES = ['learnhouse-app', 'db', 'redis'] as const

// --- Deployments view ---

function showDeployments() {
  let psOutput: string
  try {
    psOutput = execSync(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: 'pipe' },
    ).toString().trim()
  } catch {
    p.log.error('Failed to query Docker. Is Docker running?')
    process.exit(1)
  }

  if (!psOutput) {
    p.log.info('No LearnHouse deployments found.')
    p.log.message(pc.dim('  Run npx learnhouse setup to create one.'))
    return
  }

  const deployments = new Map<string, Deployment>()

  let allOutput: string
  try {
    allOutput = execSync(
      'docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: 'pipe' },
    ).toString().trim()
  } catch {
    allOutput = psOutput
  }

  for (const line of allOutput.split('\n')) {
    if (!line.trim()) continue
    const [name, status, image] = line.split('\t')

    const match = name.match(/learnhouse-\w+-([a-f0-9]+)$/)
    if (!match) continue

    const id = match[1]
    if (!deployments.has(id)) {
      deployments.set(id, { id, containers: [] })
    }
    deployments.get(id)!.containers.push({ name, status, image })
  }

  p.log.info(`Found ${pc.bold(String(deployments.size))} deployment${deployments.size === 1 ? '' : 's'}`)
  console.log()

  for (const [id, dep] of deployments) {
    const running = dep.containers.filter((c) => c.status.toLowerCase().startsWith('up')).length
    const total = dep.containers.length
    const statusColor = running === total ? pc.green : running > 0 ? pc.yellow : pc.red
    const statusText = statusColor(`${running}/${total} running`)

    console.log(`  ${pc.bold(pc.white(`Deployment ${id}`))}  ${statusText}`)
    console.log()

    for (const c of dep.containers) {
      const isUp = c.status.toLowerCase().startsWith('up')
      const icon = isUp ? pc.green('●') : pc.red('●')
      const svcName = c.name.replace(`-${id}`, '')
      console.log(`    ${icon}  ${pc.white(svcName.padEnd(24))} ${pc.dim(c.status)}`)
    }
    console.log()
  }
}

// --- Scale helpers ---

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
      result.push(line.replace(/mem_limit:.*/, `mem_limit: ${limit}`))
      insertedForService = true
      continue
    }

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

async function scaleResources() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

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

  const composePath = path.join(config.installDir || dir, 'docker-compose.yml')
  if (!fs.existsSync(composePath)) {
    p.log.error('docker-compose.yml not found.')
    process.exit(1)
  }

  let composeContent = fs.readFileSync(composePath, 'utf-8')
  const currentLimits = parseMemLimit(composePath)

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
}

// --- Main command ---

export async function deploymentsCommand() {
  p.intro(pc.cyan('LearnHouse Deployments'))

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'view', label: 'View deployments' },
      { value: 'scale', label: 'Set resource limits' },
    ],
  })
  if (p.isCancel(action)) { p.cancel(); process.exit(0) }

  if (action === 'view') {
    showDeployments()
  } else {
    await scaleResources()
  }

  p.outro(pc.dim('Done'))
}
