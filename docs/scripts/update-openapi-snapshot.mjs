#!/usr/bin/env node
// Refresh the committed OpenAPI snapshot used as a build/offline fallback.
// Usage: node scripts/update-openapi-snapshot.mjs [base-url]

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = (process.argv[2] || process.env.LEARNHOUSE_API_URL || 'https://api.learnhouse.io')
  .replace(/\/$/, '')
const url = `${base}/openapi.json`
const dest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/reference/openapi.snapshot.json'
)

const res = await fetch(url)
if (!res.ok) {
  console.error(`Failed to fetch ${url}: ${res.status}`)
  process.exit(1)
}
const spec = await res.json()
await writeFile(dest, JSON.stringify(spec))
console.log(`Wrote ${dest} (${spec.info?.title} v${spec.info?.version}, ${Object.keys(spec.paths || {}).length} paths)`)
