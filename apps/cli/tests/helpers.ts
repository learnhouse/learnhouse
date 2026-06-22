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

/** Polls a URL until it returns 2xx on TWO consecutive checks, or times out.
 *  Requiring consecutive successes avoids returning during a brief up-blip while
 *  a freshly-installed/just-upgraded stack's nginx upstream is still flapping. */
export async function waitForUrl(url: string, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let consecutive = 0
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        if (++consecutive >= 2) return true
        await new Promise((r) => setTimeout(r, 750)) // confirm stability quickly
        continue
      }
      consecutive = 0 // a non-2xx (e.g. 502) resets the streak
    } catch { consecutive = 0 /* not ready */ }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

/** Polls the org seed endpoint */
export async function waitForOrgSeed(port: number, orgSlug = 'default', timeoutMs = 60_000): Promise<boolean> {
  return waitForUrl(`http://localhost:${port}/api/v1/orgs/slug/${orgSlug}`, timeoutMs)
}

/** Login and return access token.
 *  The API uses OAuth2 password flow (form-encoded, username field = email).
 *
 *  A freshly-booted stack can return a transient 5xx (nginx upstream not yet
 *  ready / a worker recycling) even right after the org route answers OK, so we
 *  retry on 5xx and network errors. Real auth failures (4xx) fail immediately. */
export async function apiLogin(port: number, email: string, password: string): Promise<string> {
  const maxAttempts = 6
  let lastErr = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: email, password }).toString(),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      lastErr = `network error: ${(err as Error)?.message ?? err}` // proxy/upstream not reachable yet
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 2000)); continue }
      throw new Error(`Login failed after ${maxAttempts} attempts (${lastErr})`)
    }
    if (res.ok) {
      // API returns { tokens: { access_token } } (nested) or { access_token } (flat)
      const data = (await res.json()) as { tokens?: { access_token: string }; access_token?: string }
      const token = data.tokens?.access_token ?? data.access_token
      if (!token) throw new Error('Login response missing access_token')
      return token
    }
    // 5xx = stack still settling → retry; 4xx = a real auth/route failure → stop now.
    if (res.status >= 500 && attempt < maxAttempts) {
      lastErr = `${res.status}`
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    throw new Error(`Login failed: ${res.status}`)
  }
  throw new Error(`Login failed after ${maxAttempts} attempts (last: ${lastErr})`)
}

/** GET a JSON endpoint with an optional bearer token.
 *  Retries on 5xx and network errors: on a CI box the freshly-installed/just-
 *  upgraded stack's nginx upstream can flap (answer, then briefly 502) even right
 *  after a readiness poll succeeded. Real 4xx responses fail fast. */
export async function apiGet<T = unknown>(port: number, path: string, token?: string): Promise<T> {
  const maxAttempts = 6
  let lastErr = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(`http://localhost:${port}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      lastErr = `network error: ${(err as Error)?.message ?? err}`
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 2000)); continue }
      throw new Error(`GET ${path} failed after ${maxAttempts} attempts (${lastErr})`)
    }
    if (res.ok) return res.json() as Promise<T>
    if (res.status >= 500 && attempt < maxAttempts) { // upstream still settling → retry
      lastErr = `${res.status}`
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    throw new Error(`GET ${path} returned ${res.status}`) // 4xx (or final 5xx) → real failure
  }
  throw new Error(`GET ${path} failed after ${maxAttempts} attempts (last: ${lastErr})`)
}

export const TEST_NAME = 'cli-test'
export const TEST_PORT = 9099
export const TEST_ADMIN_EMAIL = 'admin@test.dev'
export const TEST_ADMIN_PASSWORD = 'testpassword123456'

export const INTEG_NAME = 'cli-integ'
export const INTEG_PORT = 9098

export const CMD_NAME = 'cli-cmd-test'
export const CMD_PORT = 9097
