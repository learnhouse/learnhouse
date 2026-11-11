import { cache } from 'react'
import {
  GITHUB_RELEASES_API,
  MAX_RELEASE_PAGES,
  NPM_PACKAGES,
  NPM_REGISTRY,
  RELEASES_CACHE_TAG,
  RELEASES_REVALIDATE_SECONDS,
} from './config'
import { normalizeRelease, sortByDateDesc } from './normalize'

/**
 * Release data for the /releases hub.
 *
 * Releases come from the GitHub REST API (unauthenticated, or with
 * GITHUB_TOKEN when set to lift the 60 req/h limit) and npm versions from the
 * npm registry. Both use the Next data cache with a 1h ISR window. When
 * GitHub fails or rate-limits, everything falls back to the committed
 * snapshot, so builds never fail and `next dev` works offline. Refresh it
 * with `node scripts/releases-snapshot.mjs`.
 */

const fetchOptions = {
  next: { revalidate: RELEASES_REVALIDATE_SECONDS, tags: [RELEASES_CACHE_TAG] },
}

async function loadSnapshot() {
  const { default: snapshot } = await import('./releases.snapshot.json')
  return snapshot
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'learnhouse-docs',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return headers
}

function nextLink(header) {
  if (!header) return null
  const m = /<([^>]+)>;\s*rel="next"/.exec(header)
  return m ? m[1] : null
}

async function fetchGithubReleases() {
  const all = []
  let url = GITHUB_RELEASES_API
  for (let page = 0; url && page < MAX_RELEASE_PAGES; page++) {
    const res = await fetch(url, { ...fetchOptions, headers: githubHeaders() })
    if (!res.ok) throw new Error(`GitHub releases returned ${res.status}`)
    const batch = await res.json()
    if (!Array.isArray(batch)) throw new Error('GitHub releases: unexpected payload')
    all.push(...batch)
    url = nextLink(res.headers.get('link'))
  }
  return all
}

/** Raw GitHub release objects plus where they came from. */
const getRawReleases = cache(async () => {
  try {
    return { releases: await fetchGithubReleases(), source: 'live' }
  } catch (err) {
    console.warn('[releases] falling back to bundled snapshot:', err?.message)
    const snapshot = await loadSnapshot()
    return { releases: snapshot.releases, source: 'snapshot', fetchedAt: snapshot.fetchedAt }
  }
})

/**
 * Every published (non-draft) app and CLI release, newest first, normalized
 * for rendering. `source` is 'live' or 'snapshot'.
 */
export const getReleases = cache(async () => {
  const { releases, source, fetchedAt } = await getRawReleases()
  const list = releases
    .filter((r) => r && !r.draft && r.tag_name)
    .map(normalizeRelease)
    .sort(sortByDateDesc)
  return { releases: list, source, fetchedAt: fetchedAt || null }
})

export async function getRelease(tag) {
  const { releases } = await getReleases()
  const index = releases.findIndex((r) => r.tag === tag)
  if (index === -1) return null
  return { release: releases[index], newer: releases[index - 1] || null, older: releases[index + 1] || null }
}

function pick(release) {
  return release ? { version: release.version, date: release.date, url: release.url, tag: release.tag } : null
}

function latestOf(releases, kind) {
  return releases.find((r) => r.kind === kind && !r.prerelease) || releases.find((r) => r.kind === kind) || null
}

/**
 * Latest stable app and CLI releases.
 * Each entry also carries `tag` (the git tag, e.g. "1.4.3" or "cli-1.6.0").
 * @returns {Promise<{ app: { version: string, date: string, url: string, tag: string } | null,
 *                     cli: { version: string, date: string, url: string, tag: string } | null }>}
 */
export async function getLatestVersions() {
  const { releases } = await getReleases()
  return { app: pick(latestOf(releases, 'app')), cli: pick(latestOf(releases, 'cli')) }
}

async function fetchNpmPackage(name) {
  const res = await fetch(`${NPM_REGISTRY}/${name.replace('/', '%2F')}`, {
    ...fetchOptions,
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) return { name, published: false, version: null, date: null }
  if (!res.ok) throw new Error(`npm ${name} returned ${res.status}`)
  const doc = await res.json()
  const version = doc['dist-tags']?.latest || null
  return {
    name,
    published: Boolean(version),
    version,
    date: version ? doc.time?.[version] || null : null,
  }
}

/**
 * Published state of @learnhouse/sdk and @learnhouse/react. A 404 means "not
 * published yet"; a network failure falls back to the snapshot's last view.
 */
export const getNpmPackages = cache(async () => {
  let snapshot = null
  return Promise.all(
    NPM_PACKAGES.map(async (name) => {
      try {
        return await fetchNpmPackage(name)
      } catch (err) {
        console.warn(`[releases] npm lookup for ${name} failed:`, err?.message)
        snapshot ||= await loadSnapshot()
        return (
          snapshot.npm?.find((p) => p.name === name) || { name, published: false, version: null, date: null }
        )
      }
    })
  )
})
