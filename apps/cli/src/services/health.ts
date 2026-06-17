import {
  EE_READY_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
} from '../constants.js'
import { dockerComposeExec } from './docker.js'

export async function waitForHealth(baseUrl: string): Promise<boolean> {
  const url = `${baseUrl}/api/v1/health`
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  return false
}

export type EeReadyResult = 'ee' | 'oss' | 'timeout'

/**
 * Wait for the EE API to come up and report `mode: ee`. The api container is
 * not published to the host (only Caddy is), and public HTTPS needs DNS first,
 * so we probe the authoritative signal from inside the container via
 * `docker compose exec api`. Returns 'ee' on success, 'oss' if it came up but
 * the license is not active, 'timeout' otherwise.
 */
export async function waitForEeReady(cwd: string): Promise<EeReadyResult> {
  const deadline = Date.now() + EE_READY_TIMEOUT_MS
  let sawOss = false
  while (Date.now() < deadline) {
    try {
      const out = dockerComposeExec(
        cwd,
        'api',
        'curl -fsS http://localhost:9000/api/v1/instance/info',
      )
      if (/"mode"\s*:\s*"ee"/.test(out)) return 'ee'
      if (/"mode"\s*:\s*"(oss|community)"/.test(out)) sawOss = true
    } catch {
      // api/container not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  return sawOss ? 'oss' : 'timeout'
}

export async function waitForOrgSeed(baseUrl: string, orgSlug: string): Promise<boolean> {
  const url = `${baseUrl}/api/v1/orgs/slug/${encodeURIComponent(orgSlug)}`
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  return false
}
