import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findInstallDir, readConfig } from '../services/config-store.js'
import { autoDetectDeploymentId, listDeploymentContainers, dockerExecInteractive } from '../services/docker.js'

export async function shellCommand() {
  const dir = findInstallDir()
  const config = readConfig(dir)
  if (!config) {
    p.log.error('No LearnHouse installation found. Run setup first.')
    process.exit(1)
  }

  const id = config.deploymentId || autoDetectDeploymentId()
  const containers = listDeploymentContainers(id || undefined)
    .filter((c) => c.status.toLowerCase().startsWith('up'))

  if (containers.length === 0) {
    p.log.error('No running containers found. Start services first.')
    process.exit(1)
  }

  const selected = await p.select({
    message: 'Select a container',
    options: containers.map((c) => ({
      value: c.name,
      label: `${c.name.replace(`-${id}`, '')} ${pc.dim(`(${c.name})`)}`,
    })),
  })
  if (p.isCancel(selected)) {
    p.cancel()
    process.exit(0)
  }

  p.log.info(`Connecting to ${selected}... (type "exit" to leave)`)

  dockerExecInteractive(selected as string, '/bin/sh')
}
