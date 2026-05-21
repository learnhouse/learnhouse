import { HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS } from '../constants.js'

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
