import * as p from '@clack/prompts'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { autoDetectDeploymentId, dockerComposeLogs, dockerLogsMulti, listDeploymentContainers } from '../services/docker.js'
import { dockerExecFileSync } from '../services/docker-bin.js'

export async function logsCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)

  p.log.info('Streaming logs (Ctrl+C to stop)...')

  // Try docker compose logs first (needs correct cwd)
  if (config?.installDir) {
    try {
      // Quick check: does docker compose see services here?
      const ps = dockerExecFileSync(['compose', 'ps', '-q'], { cwd: config.installDir, stdio: 'pipe' }).toString().trim()
      if (ps) {
        dockerComposeLogs(config.installDir)
        return
      }
    } catch { /* fall through */ }
  }

  // Fallback: stream logs from detected containers directly
  const id = config?.deploymentId || autoDetectDeploymentId()
  if (!id) {
    p.log.error('No LearnHouse containers found. Start services first.')
    process.exit(1)
  }

  const containers = listDeploymentContainers(id)
    .filter((c) => c.status.toLowerCase().startsWith('up'))

  if (containers.length === 0) {
    p.log.error('No running containers found. Start services first.')
    process.exit(1)
  }

  dockerLogsMulti(containers.map((c) => c.name))
}
