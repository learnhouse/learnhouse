import { execSync, spawn, spawnSync } from 'node:child_process'

export function isDockerInstalled(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function isDockerComposeV2(): boolean {
  try {
    execSync('docker compose version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function dockerComposeUp(cwd: string, pull = false): void {
  const cmd = pull ? 'docker compose up -d --pull always' : 'docker compose up -d'
  execSync(cmd, {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposeDown(cwd: string): void {
  execSync('docker compose down', {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposePs(cwd: string): string {
  return execSync('docker compose ps', {
    cwd,
    stdio: 'pipe',
  }).toString()
}

export function dockerComposePull(cwd: string): void {
  execSync('docker compose pull', {
    cwd,
    stdio: 'inherit',
  })
}

export function dockerComposeLogs(cwd: string): void {
  const child = spawn('docker', ['compose', 'logs', '--tail', 'all', '-f'], {
    cwd,
    stdio: 'inherit',
  })
  process.on('SIGINT', () => {
    child.kill('SIGINT')
  })
  child.on('exit', () => process.exit(0))
}

export function dockerLogsMulti(containerNames: string[]): void {
  // Spawn `docker logs --tail all -f` for each container, merge output
  const children = containerNames.map((name) =>
    spawn('docker', ['logs', '--tail', 'all', '-f', '--timestamps', name], {
      stdio: ['ignore', 'inherit', 'inherit'],
    }),
  )
  process.on('SIGINT', () => {
    for (const child of children) child.kill('SIGINT')
  })
  // Exit when all children exit
  let exited = 0
  for (const child of children) {
    child.on('exit', () => {
      exited++
      if (exited === children.length) process.exit(0)
    })
  }
}

export function dockerExecToFile(containerName: string, command: string, outputPath: string): void {
  execSync(`docker exec ${containerName} ${command} > "${outputPath}"`, {
    stdio: 'pipe',
    shell: '/bin/sh',
    maxBuffer: 1024 * 1024 * 512,
  })
}

export function dockerExecFromFile(containerName: string, command: string, inputPath: string): void {
  execSync(`docker exec -i ${containerName} ${command} < "${inputPath}"`, {
    stdio: 'pipe',
    shell: '/bin/sh',
    maxBuffer: 1024 * 1024 * 512,
  })
}

export function isContainerRunning(containerName: string): boolean {
  try {
    const output = execSync(
      `docker inspect -f '{{.State.Running}}' ${containerName}`,
      { stdio: 'pipe' },
    ).toString().trim()
    return output === 'true'
  } catch {
    return false
  }
}

export function dockerStats(cwd: string): string {
  return execSync(
    'docker compose stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}"',
    { cwd, stdio: 'pipe' },
  ).toString()
}

export function dockerStatsForContainers(containerNames: string[]): string {
  if (containerNames.length === 0) return ''
  return execSync(
    `docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}" ${containerNames.join(' ')}`,
    { stdio: 'pipe' },
  ).toString()
}

export function dockerExec(containerName: string, cmd: string): string {
  return execSync(`docker exec ${containerName} ${cmd}`, {
    stdio: 'pipe',
    timeout: 10_000,
  }).toString().trim()
}

export function getContainerLogs(containerName: string, lines: number = 50): string {
  return execSync(`docker logs --tail ${lines} ${containerName}`, {
    stdio: 'pipe',
  }).toString()
}

export function getDockerDiskUsage(): string {
  return execSync('docker system df', { stdio: 'pipe' }).toString()
}

export function autoDetectDeploymentId(): string | null {
  try {
    const output = execSync(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}"',
      { stdio: 'pipe' },
    ).toString().trim()
    if (!output) return null
    // Extract ID from first learnhouse-app-<id> container
    const match = output.split('\n')[0].match(/learnhouse-app-([a-f0-9]+)$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export function listDeploymentContainers(deploymentId?: string): { name: string; status: string; image: string }[] {
  try {
    const id = deploymentId || autoDetectDeploymentId()
    if (!id) return []
    const output = execSync(
      `docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"`,
      { stdio: 'pipe' },
    ).toString().trim()
    if (!output) return []
    return output.split('\n')
      .filter((line) => line.includes(id))
      .map((line) => {
        const [name, status, image] = line.split('\t')
        return { name, status, image }
      })
  } catch {
    return []
  }
}

export function getContainerRestartCount(containerName: string): number {
  try {
    const output = execSync(
      `docker inspect -f '{{.RestartCount}}' ${containerName}`,
      { stdio: 'pipe' },
    ).toString().trim()
    return parseInt(output, 10) || 0
  } catch {
    return 0
  }
}

export function dockerExecInteractive(containerName: string, cmd: string): void {
  const result = spawnSync('docker', ['exec', '-it', containerName, ...cmd.split(' ')], {
    stdio: 'inherit',
  })
  if (result.status !== null) {
    process.exitCode = result.status
  }
}
