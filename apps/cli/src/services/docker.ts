import { execFileSync, execSync, type StdioOptions } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dockerExecFileSync, dockerSpawnSync, dockerSpawn } from './docker-bin.js'

// Every docker invocation goes through execFileSync with an argument array, so
// nothing here is parsed by a shell: no quoting bugs on paths with spaces, no
// injection through names read from config files, and the same behavior on
// Windows (cmd.exe) as on POSIX shells.

/** Bounds how long a probe can hang on a stale DOCKER_HOST or a daemon that is still starting. */
const PROBE_TIMEOUT_MS = 15_000

function docker(
  args: string[],
  opts: { cwd?: string; stdio?: StdioOptions; timeout?: number } = {},
): string {
  const out = dockerExecFileSync(args, { stdio: 'pipe', ...opts })
  return out ? out.toString() : ''
}

export function isDockerInstalled(): boolean {
  try {
    docker(['--version'], { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

export function isDockerRunning(): boolean {
  try {
    docker(['info'], { timeout: PROBE_TIMEOUT_MS })
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
  docker(['compose', 'up', '-d', ...(pull ? ['--pull', 'always'] : [])], { cwd, stdio: 'inherit' })
}

export function dockerComposeDown(cwd: string): void {
  docker(['compose', 'down'], { cwd, stdio: 'inherit' })
}

/**
 * Recreate specific services even if their definition did not change. Needed
 * after rewriting a bind-mounted single-file config (Caddyfile, nginx conf):
 * the file is replaced by rename, so a running container keeps the old inode.
 */
export function dockerComposeRecreate(cwd: string, services: string[]): void {
  if (services.length === 0) return
  docker(['compose', 'up', '-d', '--force-recreate', '--no-deps', ...services], { cwd, stdio: 'inherit' })
}

/**
 * Stop containers without removing them. Unlike `down`, the containers (and
 * anything in their writable layer) survive, and `up -d` resumes them as-is.
 * With no service, stops the whole stack.
 */
export function dockerComposeStop(cwd: string, service?: string): void {
  docker(['compose', 'stop', ...(service ? [service] : [])], { cwd, stdio: 'inherit' })
}

/**
 * Authenticate to a container registry. The password is piped via stdin
 * (never on the command line / process table / shell history).
 * Throws if login fails (e.g. invalid license key).
 */
export function dockerLogin(registry: string, username: string, password: string): void {
  const res = dockerSpawnSync(['login', registry, '--username', username, '--password-stdin'],
    { input: password, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  if (res.status !== 0) {
    const stderr = res.stderr?.toString() ?? ''
    const err = new Error(`docker login to ${registry} failed`) as Error & { stderr?: string }
    err.stderr = stderr
    throw err
  }
}

/** Drop stored registry credentials (best effort). `docker login` keeps them in ~/.docker/config.json. */
export function dockerLogout(registry: string): void {
  try {
    docker(['logout', registry])
  } catch {
    // not logged in / no credential store: nothing to remove
  }
}

/** Run a shell command inside a compose service (no TTY). Returns stdout.
 *  `command` is interpreted by the container's `sh`, never the host shell.
 *  `-T` disables pseudo-TTY allocation, required because callers capture
 *  stdout non-interactively; without it `docker compose exec` can abort with
 *  "the input device is not a TTY" on setups that allocate a TTY when piped. */
export function dockerComposeExec(cwd: string, service: string, command: string): string {
  return docker(['compose', 'exec', '-T', service, 'sh', '-c', command], { cwd })
}

/**
 * Run a shell command in a fresh one-off container of a service, using
 * whatever image the compose file currently names for it. `--no-deps` leaves
 * the running stack alone; the container still joins the compose network, so
 * it reaches `db` like the real service would.
 */
export function dockerComposeRun(cwd: string, service: string, command: string): string {
  return docker(['compose', 'run', '--rm', '--no-deps', '-T', service, 'sh', '-c', command], { cwd })
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
      docker(['compose', 'up', '-d'], { cwd, stdio: 'inherit' })
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
 * lsof/ss (not a bind attempt: privileged ports <1024 can't be bound by a
 * non-root process, which would false-positive). If no probe tool is available,
 * returns false (don't block; docker would surface a real conflict at `up`).
 */
export function isTcpPortListening(port: number): boolean {
  const probes: [string, string[]][] = [
    ['lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']],
    ['ss', ['-ltnH', `sport = :${port}`]],
  ]
  for (const [cmd, args] of probes) {
    try {
      const out = execFileSync(cmd, args, { stdio: 'pipe' }).toString().trim()
      if (out) return true
    } catch {
      // tool missing or nothing listening; try the next probe
    }
  }
  return false
}

/** True if the `docker compose` v2 plugin is available. */
export function dockerComposeWorks(): boolean {
  try {
    docker(['compose', 'version'], { timeout: PROBE_TIMEOUT_MS })
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
  // Private temp dir: a fixed /tmp path could be pre-created or swapped by
  // another local user between download and the (often root) `sh` run.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-get-docker-'))
  const script = path.join(tmpDir, 'get-docker.sh')
  try {
    execFileSync('curl', ['-fsSL', 'https://get.docker.com', '-o', script], { stdio: 'pipe' })
    try {
      execFileSync('sh', [script], { stdio: 'inherit' })
    } catch {
      waitForAptLock()
      execFileSync('sh', [script], { stdio: 'inherit' })
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  try { execFileSync('systemctl', ['enable', '--now', 'docker'], { stdio: 'pipe' }) } catch { /* non-systemd */ }
}

export function dockerComposePs(cwd: string): string {
  return docker(['compose', 'ps'], { cwd })
}

export function dockerComposePull(cwd: string): void {
  docker(['compose', 'pull'], { cwd, stdio: 'inherit' })
}

/** Pull a single image. Used to confirm a target image exists before any file is rewritten. */
export function dockerPull(image: string): void {
  docker(['pull', image], { stdio: 'inherit' })
}

export function dockerComposeLogs(cwd: string): void {
  const child = dockerSpawn(['compose', 'logs', '--tail', 'all', '-f'], {
    cwd,
    stdio: 'inherit',
  })
  process.on('SIGINT', () => {
    child.kill('SIGINT')
  })
  child.on('error', (err) => {
    console.error(`Could not run docker: ${err.message}`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(signal === 'SIGINT' ? 0 : code ?? 0))
}

export function dockerLogsMulti(containerNames: string[]): void {
  // Spawn `docker logs --tail all -f` for each container, merge output
  const children = containerNames.map((name) =>
    dockerSpawn(['logs', '--tail', 'all', '-f', '--timestamps', name], {
      stdio: ['ignore', 'inherit', 'inherit'],
    }),
  )
  process.on('SIGINT', () => {
    for (const child of children) child.kill('SIGINT')
  })
  // Exit when all children exit; non-zero if any of them failed
  let exited = 0
  let worst = 0
  for (const child of children) {
    child.on('error', (err) => {
      console.error(`Could not run docker: ${err.message}`)
      process.exit(1)
    })
    child.on('exit', (code, signal) => {
      exited++
      if (signal !== 'SIGINT' && code) worst = code
      if (exited === children.length) process.exit(worst)
    })
  }
}

/**
 * Run a command in a container and stream its stdout into a file (no shell, no
 * buffering in memory). `okStatuses` lists exit codes that still count as
 * success (GNU tar exits 1 when a file changed while it was read).
 */
export function dockerExecToFile(containerName: string, command: string[], outputPath: string, okStatuses: number[] = [0]): void {
  const fd = fs.openSync(outputPath, 'w', 0o600)
  try {
    const res = dockerSpawnSync(['exec', containerName, ...command], {
      stdio: ['ignore', fd, 'pipe'],
    })
    if (res.error) throw res.error
    if (res.status === null || !okStatuses.includes(res.status)) {
      throw Object.assign(new Error(`docker exec ${command[0]} exited with ${res.status}`), {
        stderr: res.stderr,
      })
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** Run a command in a container with a file as its stdin. Throws (with stderr) on a non-zero exit. */
export function dockerExecFromFile(containerName: string, command: string[], inputPath: string): void {
  const fd = fs.openSync(inputPath, 'r')
  try {
    const res = dockerSpawnSync(['exec', '-i', containerName, ...command], {
      stdio: [fd, 'ignore', 'pipe'],
    })
    if (res.error) throw res.error
    if (res.status !== 0) {
      throw Object.assign(new Error(`docker exec ${command[0]} exited with ${res.status}`), {
        stderr: res.stderr,
      })
    }
  } finally {
    fs.closeSync(fd)
  }
}

export function isContainerRunning(containerName: string): boolean {
  try {
    const output = docker(['inspect', '-f', '{{.State.Running}}', containerName]).trim()
    return output === 'true'
  } catch {
    return false
  }
}

/**
 * Container id of a compose service in the install at `cwd` ('' if none).
 * Works for every edition: Community names containers `learnhouse-db-<id>`,
 * Enterprise leaves naming to compose (`learnhouse-<id>-db-1`), so the service
 * name is the only stable handle.
 */
export function composeServiceContainer(cwd: string, service: string, runningOnly = true): string {
  try {
    const args = ['compose', 'ps', '-q', ...(runningOnly ? ['--status', 'running'] : []), service]
    return docker(args, { cwd }).trim().split('\n')[0] ?? ''
  } catch {
    return ''
  }
}

/** Service names declared in the install's compose file (running or not). */
export function composeServices(cwd: string): string[] {
  try {
    return docker(['compose', 'config', '--services'], { cwd }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** True if any container of the compose project `learnhouse-<id>` is running. */
export function isDeploymentRunning(deploymentId: string): boolean {
  try {
    const out = docker([
      'ps', '-q',
      '--filter', `label=com.docker.compose.project=learnhouse-${deploymentId}`,
      '--filter', 'status=running',
    ]).trim()
    return out.length > 0
  } catch {
    return false
  }
}

export function dockerStats(cwd: string): string {
  return docker(
    ['compose', 'stats', '--no-stream', '--format', 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}'],
    { cwd },
  )
}

export function dockerStatsForContainers(containerNames: string[]): string {
  if (containerNames.length === 0) return ''
  return docker([
    'stats', '--no-stream', '--format', 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}',
    ...containerNames,
  ])
}

export function dockerExec(containerName: string, command: string[]): string {
  return docker(['exec', containerName, ...command], { timeout: 10_000 }).trim()
}

export function getContainerLogs(containerName: string, lines: number = 50): string {
  return docker(['logs', '--tail', String(lines), containerName])
}

export function getDockerDiskUsage(): string {
  return docker(['system', 'df'])
}

// Community: learnhouse-app-<id>. Enterprise: learnhouse-<id>-api-1 (compose default naming).
const APP_CONTAINER_RE = /^learnhouse-app-([a-f0-9]+)$|^learnhouse-([a-f0-9]+)-api-\d+$/

export function autoDetectDeploymentId(): string | null {
  try {
    const output = docker(['ps', '-a', '--filter', 'name=learnhouse-', '--format', '{{.Names}}']).trim()
    if (!output) return null
    for (const name of output.split('\n')) {
      const match = name.trim().match(APP_CONTAINER_RE)
      if (match) return match[1] ?? match[2]
    }
    return null
  } catch {
    return null
  }
}

export interface DeploymentContainer {
  name: string
  status: string
  image: string
  /** Compose service name (e.g. `db`, `api`, `learnhouse-app`); derived from the name when unlabeled. */
  service: string
}

/** True if `name` is one of this deployment's containers, in either naming scheme. */
export function containerBelongsTo(name: string, deploymentId: string): boolean {
  return name.endsWith(`-${deploymentId}`) || name.startsWith(`learnhouse-${deploymentId}-`)
}

function serviceFromName(name: string, deploymentId: string): string {
  if (name.startsWith(`learnhouse-${deploymentId}-`)) {
    return name.slice(`learnhouse-${deploymentId}-`.length).replace(/-\d+$/, '')
  }
  return name.replace(`-${deploymentId}`, '')
}

export function listDeploymentContainers(deploymentId?: string): DeploymentContainer[] {
  try {
    const id = deploymentId || autoDetectDeploymentId()
    if (!id) return []
    const output = docker([
      'ps', '-a', '--filter', 'name=learnhouse-',
      '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Label "com.docker.compose.service"}}',
    ]).trim()
    if (!output) return []
    return output.split('\n')
      .map((line) => line.split('\t'))
      .filter(([name]) => !!name && containerBelongsTo(name, id))
      .map(([name, status = '', image = '', service = '']) => ({
        name,
        status,
        image,
        service: service || serviceFromName(name, id),
      }))
  } catch {
    return []
  }
}

export function getContainerRestartCount(containerName: string): number {
  try {
    const output = docker(['inspect', '-f', '{{.RestartCount}}', containerName]).trim()
    return parseInt(output, 10) || 0
  } catch {
    return 0
  }
}

export function dockerExecInteractive(containerName: string, cmd: string): void {
  const result = dockerSpawnSync(['exec', '-it', containerName, ...cmd.split(' ')], {
    stdio: 'inherit',
  })
  if (result.status !== null) {
    process.exitCode = result.status
  }
}
