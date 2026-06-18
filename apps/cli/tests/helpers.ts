import { execSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CLI_PATH = path.resolve(__dirname, '..', 'dist', 'bin', 'learnhouse.js')

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function cli(args: string, timeoutMs = 120_000): CliResult {
  return cliWithHome(process.env.HOME ?? '', args, timeoutMs)
}

export function cliWithHome(home: string, args: string, timeoutMs = 120_000): CliResult {
  const realHome = process.env.HOME ?? os.homedir()
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(home ? {
          HOME: home,
          // Docker CLI plugins are resolved relative to HOME (~/.docker/cli-plugins).
          // Preserve the real DOCKER_CONFIG so compose/buildx still work when HOME is overridden.
          DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? path.join(realHome, '.docker'),
        } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      exitCode: err.status ?? 1,
    }
  }
}

/** Returns the image string of a running container (e.g. "ghcr.io/learnhouse/app:1.2.6") */
export function getContainerImage(containerName: string): string {
  const r = spawnSync('docker', ['inspect', '--format', '{{.Config.Image}}', containerName], {
    encoding: 'utf-8',
  })
  return r.status === 0 ? r.stdout.trim() : ''
}

/** Returns the names of running containers matching a substring */
export function getRunningContainers(nameFilter: string): string[] {
  const r = spawnSync(
    'docker',
    ['ps', '--filter', `name=${nameFilter}`, '--format', '{{.Names}}'],
    { encoding: 'utf-8' },
  )
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : []
}

/** Run a command inside a compose service and return stdout */
export function composeExec(cwd: string, service: string, cmd: string): string {
  const r = spawnSync('docker', ['compose', 'exec', service, 'sh', '-c', cmd], {
    cwd,
    encoding: 'utf-8',
  })
  return r.stdout ?? ''
}

/** Pull and start compose services, waiting for health checks */
export function composeUp(cwd: string, env?: NodeJS.ProcessEnv): void {
  spawnSync('docker', ['compose', 'pull'], { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  spawnSync('docker', ['compose', 'up', '-d', '--wait'], { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

/** Stop and remove compose containers + volumes */
export function composeDown(cwd: string): void {
  spawnSync('docker', ['compose', 'down', '-v'], { cwd, stdio: 'pipe' })
}

/** Polls a URL until it returns 2xx or timeout */
export async function waitForUrl(url: string, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      if (res.ok) return true
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

/** Polls the org seed endpoint */
export async function waitForOrgSeed(port: number, orgSlug = 'default', timeoutMs = 60_000): Promise<boolean> {
  return waitForUrl(`http://localhost:${port}/api/v1/orgs/slug/${orgSlug}`, timeoutMs)
}

/** Login and return access token.
 *  The API uses OAuth2 password flow (form-encoded, username field = email). */
export async function apiLogin(port: number, email: string, password: string): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  // API returns { tokens: { access_token } } (nested) or { access_token } (flat)
  const data = (await res.json()) as { tokens?: { access_token: string }; access_token?: string }
  const token = data.tokens?.access_token ?? data.access_token
  if (!token) throw new Error('Login response missing access_token')
  return token
}

/** GET a JSON endpoint with an optional bearer token */
export async function apiGet<T = unknown>(port: number, path: string, token?: string): Promise<T> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GET ${path} returned ${res.status}`)
  return res.json() as Promise<T>
}

export const TEST_NAME = 'cli-test'
export const TEST_PORT = 9099
export const TEST_ADMIN_EMAIL = 'admin@test.dev'
export const TEST_ADMIN_PASSWORD = 'testpassword123456'

export const INTEG_NAME = 'cli-integ'
export const INTEG_PORT = 9098

export const CMD_NAME = 'cli-cmd-test'
export const CMD_PORT = 9097
