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
  } catch (err: unknown) {
    const stderr = err instanceof Error && 'stderr' in err
      ? (err as { stderr: Buffer }).stderr?.toString() ?? ''
      : ''
    if (stderr.includes('permission denied')) {
      throw new Error(
        'Docker permission denied. Run: sudo usermod -aG docker $USER && newgrp docker'
      )
    }
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

/**
 * Authenticate to a container registry. The password is piped via stdin
 * (never on the command line / process table / shell history).
 * Throws if login fails (e.g. invalid license key).
 */
export function dockerLogin(registry: string, username: string, password: string): void {
  const res = spawnSync(
    'docker',
    ['login', registry, '--username', username, '--password-stdin'],
    { input: password, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  if (res.status !== 0) {
    const stderr = res.stderr?.toString() ?? ''
    const err = new Error(`docker login to ${registry} failed`) as Error & { stderr?: string }
    err.stderr = stderr
    throw err
  }
}

/** Run a command inside a compose service (no TTY). Returns combined stdout.
 *  `-T` disables pseudo-TTY allocation — required because callers capture
 *  stdout non-interactively; without it `docker compose exec` can abort with
 *  "the input device is not a TTY" on setups that allocate a TTY when piped. */
export function dockerComposeExec(cwd: string, service: string, command: string): string {
  return execSync(`docker compose exec -T ${service} ${command}`, {
    cwd,
    stdio: 'pipe',
  }).toString()
}

/**
 * `docker compose up -d`, retried. On first boot the Postgres health check can
 * exceed the dependency wait window during image extraction, so `up` aborts
 * with "dependency ... is unhealthy" even though the DB comes healthy moments
 * later. A retry then starts the remaining services.
 */
export function dockerComposeUpRetry(cwd: string, attempts = 3, onRetry?: (attempt: number) => void): void {
  for (let i = 1; i <= attempts; i++) {
    try {
      execSync('docker compose up -d', { cwd, stdio: 'inherit' })
      return
    } catch (err) {
      if (i >= attempts) throw err
      onRetry?.(i)
      sleepBlockingMs(15_000) // settle before retry without pinning a CPU core
    }
  }
}

/** Block the current thread for `ms` without busy-looping. */
function sleepBlockingMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * True only if a process is *confirmed* LISTENING on the TCP port. Uses
 * lsof/ss (not a bind attempt — privileged ports <1024 can't be bound by a
 * non-root process, which would false-positive). If no probe tool is available,
 * returns false (don't block; docker would surface a real conflict at `up`).
 */
export function isTcpPortListening(port: number): boolean {
  for (const cmd of [
    `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    `ss -ltnH 'sport = :${port}'`,
  ]) {
    try {
      const out = execSync(cmd, { stdio: 'pipe' }).toString().trim()
      if (out) return true
    } catch {
      // tool missing or nothing listening — try the next probe
    }
  }
  return false
}

/** True if the `docker compose` v2 plugin is available. */
export function dockerComposeWorks(): boolean {
  try {
    execSync('docker compose version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** On apt systems, wait for cloud-init / dpkg lock to clear (fresh-VPS first boot). */
export function waitForAptLock(maxSeconds = 300): void {
  try { execSync('command -v apt-get', { stdio: 'pipe' }) } catch { return } // not apt-based
  try {
    execSync('command -v cloud-init', { stdio: 'pipe' })
    execSync('cloud-init status --wait', { stdio: 'pipe', timeout: 300_000 })
  } catch { /* no cloud-init or already done */ }
  const deadline = Date.now() + maxSeconds * 1000
  while (Date.now() < deadline) {
    try {
      execSync('pgrep -x dpkg >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x unattended-upgr >/dev/null 2>&1', { stdio: 'pipe' })
      sleepBlockingMs(5000) // something holds the lock; wait
    } catch {
      return // nothing running → lock is free
    }
  }
}

/** Install Docker Engine + compose plugin on Linux via get.docker.com. */
export function installDockerLinux(): void {
  waitForAptLock()
  execSync('curl -fsSL https://get.docker.com -o /tmp/get-docker.sh', { stdio: 'pipe' })
  try {
    execSync('sh /tmp/get-docker.sh', { stdio: 'inherit' })
  } catch {
    waitForAptLock()
    execSync('sh /tmp/get-docker.sh', { stdio: 'inherit' })
  }
  try { execSync('systemctl enable --now docker', { stdio: 'pipe' }) } catch { /* non-systemd */ }
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
