#!/usr/bin/env node
// Refresh the committed releases snapshot used by /releases as a build/offline
// fallback when the GitHub API is unreachable or rate limited.
// Usage: node scripts/releases-snapshot.mjs   (set GITHUB_TOKEN to avoid the 60 req/h limit)
//
// Keep the URLs in sync with lib/releases/config.js.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const RELEASES_API = 'https://api.github.com/repos/learnhouse/learnhouse/releases?per_page=100'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const NPM_PACKAGES = ['@learnhouse/sdk', '@learnhouse/react']
const MAX_PAGES = 10

const dest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/releases/releases.snapshot.json'
)

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'learnhouse-docs',
}
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const releases = []
let url = RELEASES_API
for (let page = 0; url && page < MAX_PAGES; page++) {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    console.error(`Failed to fetch ${url}: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  releases.push(...(await res.json()))
  const link = res.headers.get('link')
  url = link && /<([^>]+)>;\s*rel="next"/.exec(link)?.[1]
}

const npm = []
for (const name of NPM_PACKAGES) {
  const res = await fetch(`${NPM_REGISTRY}/${name.replace('/', '%2F')}`, {
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    npm.push({ name, published: false, version: null, date: null })
    continue
  }
  if (!res.ok) {
    console.error(`Failed to fetch ${name} from npm: ${res.status}`)
    process.exit(1)
  }
  const doc = await res.json()
  const version = doc['dist-tags']?.latest || null
  npm.push({ name, published: Boolean(version), version, date: version ? doc.time?.[version] || null : null })
}

const slim = releases
  .filter((r) => !r.draft)
  .map((r) => ({
    tag_name: r.tag_name,
    name: r.name,
    body: r.body || '',
    html_url: r.html_url,
    published_at: r.published_at,
    created_at: r.created_at,
    prerelease: Boolean(r.prerelease),
    draft: false,
  }))

await writeFile(dest, JSON.stringify({ fetchedAt: new Date().toISOString(), releases: slim, npm }, null, 1) + '\n')

const app = slim.filter((r) => !r.tag_name.startsWith('cli-')).length
console.log(
  `Wrote ${dest}: ${slim.length} releases (${app} app, ${slim.length - app} CLI); ` +
    npm.map((p) => `${p.name} ${p.published ? p.version : 'not published'}`).join(', ')
)
