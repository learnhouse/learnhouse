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

/**
 * Verify the default organization was actually seeded. The API can come up
 * healthy (lifespan didn't crash) while the seed silently failed — e.g.
 * when the bundled image has a sync `cli.py` that calls async setup
 * functions without `await`. Symptom: prints "Default organization
 * created ✅" but the `organization` table is empty and
 * `/api/v1/orgs/slug/<slug>` returns 404.
 *
 * Polls for up to ~30s (the seed should land within seconds of the
 * `/api/v1/health` ok). Returns true if the org responds, false if it
 * never does within the deadline.
 */
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
