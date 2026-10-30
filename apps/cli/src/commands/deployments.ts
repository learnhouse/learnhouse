import * as p from '../utils/prompt.js'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { scaleResources } from './scale.js'
import { dockerExecFileSync } from '../services/docker-bin.js'

interface Deployment {
  id: string
  containers: { name: string; status: string; image: string; service: string }[]
}

// Community names containers learnhouse-<service>-<id>; Enterprise leaves it to
// compose (learnhouse-<id>-<service>-<n>). The compose project label is
// learnhouse-<id> for both, so it is tried first.
const PROJECT_RE = /^learnhouse-([a-z0-9][a-z0-9_-]*)$/
const CE_NAME_RE = /^learnhouse-([\w-]+)-([a-f0-9]+)$/
const EE_NAME_RE = /^learnhouse-([a-f0-9]+)-([\w-]+)-\d+$/

export function parseDeploymentLine(line: string): { id: string; container: Deployment['containers'][number] } | null {
  const [name, status = '', image = '', project = '', service = ''] = line.split('\t')
  if (!name) return null
  const fromLabel = project.match(PROJECT_RE)
  if (fromLabel) {
    return { id: fromLabel[1], container: { name, status, image, service: service || name } }
  }
  const ee = name.match(EE_NAME_RE)
  if (ee) return { id: ee[1], container: { name, status, image, service: ee[2] } }
  const ce = name.match(CE_NAME_RE)
  if (ce) return { id: ce[2], container: { name, status, image, service: `learnhouse-${ce[1]}` } }
  return null
}

function showDeployments() {
  let output: string
  try {
    output = dockerExecFileSync([
      'ps', '-a', '--filter', 'name=learnhouse-',
      '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}',
    ], { stdio: 'pipe' }).toString().trim()
  } catch {
    p.log.error('Failed to query Docker. Is Docker running?')
    process.exit(1)
  }

  const deployments = new Map<string, Deployment>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const parsed = parseDeploymentLine(line)
    if (!parsed) continue
    if (!deployments.has(parsed.id)) deployments.set(parsed.id, { id: parsed.id, containers: [] })
    deployments.get(parsed.id)!.containers.push(parsed.container)
  }

  if (deployments.size === 0) {
    p.log.info('No LearnHouse deployments found.')
    p.log.message(pc.dim('  Run npx learnhouse setup to create one.'))
    return
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
      console.log(`    ${icon}  ${pc.white(c.service.padEnd(24))} ${pc.dim(c.status)}`)
    }
    console.log()
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
    const config = readConfig(findInstallDir())
    if (!config) {
      p.log.error('No LearnHouse installation found. Run setup first.')
      process.exit(1)
    }
    await scaleResources(config)
  }

  p.outro(pc.dim('Done'))
}
