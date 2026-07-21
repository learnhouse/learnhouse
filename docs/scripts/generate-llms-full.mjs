import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_GROUPS, METHOD_TO_ACTION } from '../lib/reference/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(__dirname, '..', 'content')
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'llms-full.txt')
const SITE_URL = 'https://docs.learnhouse.app'
const API_BASE_URL = (process.env.LEARNHOUSE_API_URL || 'https://api.learnhouse.io').replace(/\/$/, '')
const SNAPSHOT_PATH = path.join(__dirname, '..', 'lib', 'reference', 'openapi.snapshot.json')

function collectMdxFiles(dir, basePath = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMdxFiles(fullPath, path.join(basePath, entry.name)))
    } else if (entry.name.endsWith('.mdx')) {
      const slug = entry.name === 'index.mdx'
        ? basePath || '/'
        : path.join(basePath, entry.name.replace(/\.mdx$/, ''))
      files.push({ filePath: fullPath, slug: slug.replace(/\\/g, '/') })
    }
  }

  return files
}

function stripMdxImportsAndJsx(content) {
  // Remove import lines
  let cleaned = content.replace(/^import\s+.*$/gm, '')

  // Remove JSX component tags like <Callout ...>...</Callout> but keep inner text
  cleaned = cleaned.replace(/<Callout[^>]*>\n?/g, '')
  cleaned = cleaned.replace(/<\/Callout>\n?/g, '')

  // Remove self-closing JSX tags like <img ... />
  cleaned = cleaned.replace(/<img[^>]*\/?\s*>/g, '')

  // Remove other self-closing component tags
  cleaned = cleaned.replace(/<[A-Z][a-zA-Z]*[^>]*\/>/g, '')

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  return cleaned.trim()
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : 'Untitled'
}

const mdxFiles = collectMdxFiles(CONTENT_DIR)

// Sort: index first, then alphabetical
mdxFiles.sort((a, b) => {
  if (a.slug === '/') return -1
  if (b.slug === '/') return 1
  return a.slug.localeCompare(b.slug)
})

const sections = []

sections.push('# LearnHouse Documentation — Full Content')
sections.push('')
sections.push('> This file contains the complete text of all LearnHouse documentation pages.')
sections.push(`> Source: ${SITE_URL}`)
sections.push('')

for (const { filePath, slug } of mdxFiles) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const cleaned = stripMdxImportsAndJsx(raw)
  const title = extractTitle(cleaned)
  const url = slug === '/' ? SITE_URL : `${SITE_URL}/${slug}`

  sections.push('---')
  sections.push('')
  sections.push(`# ${title}`)
  sections.push(`URL: ${url}`)
  sections.push('')
  // Remove the first heading since we already printed it
  const body = cleaned.replace(/^#\s+.+\n*/, '').trim()
  if (body) {
    sections.push(body)
  }
  sections.push('')
}

// ── API Reference (generated from the OpenAPI spec) ──────────────────────────
// Compact per-endpoint text so LLMs and agents can drive the API from this file.

async function loadSpec() {
  try {
    const res = await fetch(`${API_BASE_URL}/openapi.json`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`spec fetch ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn(`llms-full: using OpenAPI snapshot (${err.message})`)
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'))
  }
}

function paramLine(p) {
  const type = p.schema?.type || 'string'
  return `${p.name} (${p.in}, ${type}${p.required ? ', required' : ''})`
}

const spec = await loadSpec()
const tagToGroup = new Map()
for (const group of API_GROUPS) {
  for (const tag of group.tags) tagToGroup.set(tag, group)
}

const opsByGroup = new Map(API_GROUPS.map((g) => [g.slug, []]))
for (const [specPath, methods] of Object.entries(spec.paths || {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = methods?.[method]
    if (!op) continue
    const group = tagToGroup.get(op.tags?.[0])
    if (!group) continue
    opsByGroup.get(group.slug).push({ path: specPath, method: method.toUpperCase(), op })
  }
}

sections.push('---')
sections.push('')
sections.push('# LearnHouse API Reference')
sections.push(`URL: ${SITE_URL}/reference`)
sections.push('')
sections.push(`Base URL: ${API_BASE_URL} — all endpoints are prefixed with /api/v1.`)
sections.push('Authentication: send an organization API token (prefix lh_, Pro plan) as')
sections.push('`Authorization: Bearer <token>`. Session-only endpoints reject API tokens and')
sections.push('need a user JWT from POST /api/v1/auth/login (form-encoded username/password).')
sections.push('Errors return JSON `{ "detail": "..." }`; validation failures return 422.')
sections.push('')

for (const group of API_GROUPS) {
  const ops = opsByGroup.get(group.slug)
  if (!ops.length) continue
  sections.push(`## ${group.title} (${SITE_URL}/reference/${group.slug})`)
  sections.push('')
  sections.push(group.description)
  const accessNote = {
    token: 'Auth: API token (rights bucket "' + group.rightsBucket + '") or user session.',
    'token-required': 'Auth: API token required.',
    session: 'Auth: user session only — API tokens are rejected.',
    public: 'Auth: public/credential endpoints.',
  }[group.access]
  if (accessNote) sections.push(accessNote)
  sections.push('')
  for (const { path: opPath, method, op } of ops) {
    const params = (op.parameters || []).map(paramLine).join('; ')
    const body = op.requestBody?.content
      ? ` Body: ${Object.keys(op.requestBody.content)[0]}.`
      : ''
    const right =
      group.rightsBucket && METHOD_TO_ACTION[method]
        ? ` Requires ${group.rightsBucket}:${METHOD_TO_ACTION[method]}.`
        : ''
    sections.push(`- ${method} ${opPath} — ${op.summary || ''}${params ? ` Params: ${params}.` : ''}${body}${right}`)
  }
  sections.push('')
}

fs.writeFileSync(OUTPUT_FILE, sections.join('\n'))
console.log(`Generated llms-full.txt (${mdxFiles.length} pages + API reference)`)
