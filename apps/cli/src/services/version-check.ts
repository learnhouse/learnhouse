import pc from 'picocolors'
import { VERSION } from '../constants.js'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/learnhouse'
const GHCR_BASE = 'ghcr.io/learnhouse/app'

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

/**
 * Check npm for the latest version and warn if outdated.
 * Non-blocking — silently fails on network errors.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const resp = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return
    const data = await resp.json() as { 'dist-tags'?: { latest?: string } }
    const latest = data['dist-tags']?.latest
    if (!latest) return

    if (compareVersions(latest, VERSION) > 0) {
      console.log()
      console.log(pc.yellow(`  Update available: ${VERSION} → ${pc.bold(latest)}`))
      console.log(pc.dim(`  Run: npx learnhouse@latest`))
      console.log()
    }
  } catch {
    // Network error — skip silently
  }
}

/**
 * Resolve the best Docker image tag for the LearnHouse app.
 * Tries versioned tag first (e.g. ghcr.io/learnhouse/app:0.2.0),
 * falls back to :latest with a warning.
 */
export async function resolveAppImage(): Promise<{ image: string; isLatest: boolean }> {
  const versionedTag = `${GHCR_BASE}:${VERSION}`

  // Check if the versioned tag exists via GHCR token-less API
  try {
    // Get anonymous token
    const tokenResp = await fetch(
      `https://ghcr.io/token?scope=repository:learnhouse/app:pull`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!tokenResp.ok) throw new Error('token fetch failed')
    const { token } = await tokenResp.json() as { token: string }

    // Check manifest for versioned tag
    const manifestResp = await fetch(
      `https://ghcr.io/v2/learnhouse/app/manifests/${VERSION}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: {
          Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
          Authorization: `Bearer ${token}`,
        },
      },
    )

    if (manifestResp.ok) {
      return { image: versionedTag, isLatest: false }
    }
  } catch {
    // Network error — fall through to latest
  }

  return { image: `${GHCR_BASE}:latest`, isLatest: true }
}
