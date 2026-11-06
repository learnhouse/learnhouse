import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_GROUPS, METHOD_TO_ACTION } from '../lib/reference/config.js'
import { demoListFrom, listContentPages, mdxToMarkdown } from '../lib/markdown/mdx-to-md.mjs'
import { TAB_DATA } from '../components/site/tabs.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(__dirname, '..', 'content')
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'llms-full.txt')
const SITE_URL = 'https://docs.learnhouse.app'
const API_BASE_URL = (process.env.LEARNHOUSE_API_URL || 'https://api.learnhouse.io').replace(/\/$/, '')
const SNAPSHOT_PATH = path.join(__dirname, '..', 'lib', 'reference', 'openapi.snapshot.json')




const DEMOS_JSON = path.join(__dirname, '..', 'components', 'headless', 'demos.json')
const pages = listContentPages(CONTENT_DIR).map(({ slug, file }) => {
  const { title, description, markdown } = mdxToMarkdown(fs.readFileSync(file, 'utf-8'), {
    demoList: () => demoListFrom(DEMOS_JSON),
  })
  return { slug, title, description, markdown, url: slug ? `${SITE_URL}/${slug}` : SITE_URL }
})

const sections = []

sections.push('# LearnHouse Documentation: Full Content')
sections.push('')
sections.push('> This file contains the complete text of all LearnHouse documentation pages.')
sections.push(`> Source: ${SITE_URL}. Each page is also available on its own at <page URL>.md`)
sections.push('')

for (const page of pages) {
  sections.push('---')
  sections.push('')
  sections.push(`URL: ${page.url}`)
  sections.push('')
  sections.push(page.markdown.trim())
  sections.push('')
}

// ── llms.txt: an index of every page, grouped like the site's tabs ───────────
const llms = [
  '# LearnHouse Documentation',
  '',
  '> LearnHouse is an open-source learning platform: a block editor for courses, AI tutoring, assignments, payments and communities, on LearnHouse Cloud or self-hosted with one command. Developers can build on it with the REST API, the @learnhouse/sdk TypeScript client, and the @learnhouse/react and @learnhouse/vue components.',
  '',
  'Every page below is plain Markdown at its URL. The complete text of all pages is at ' + SITE_URL + '/llms-full.txt.',
  '',
]
for (const tab of TAB_DATA) {
  const inTab = pages.filter((p) => tab.folders.some((f) => `/${p.slug}` === f || `/${p.slug}`.startsWith(f + '/')))
  if (tab.key === 'reference') {
    llms.push(
      '## API Reference',
      '',
      `- [API Reference index](${SITE_URL}/reference/llms.txt): every endpoint group as Markdown, with parameters, schemas and examples`,
      `- [Operations JSON](${SITE_URL}/reference/operations.json): machine-readable list of every operation`,
      '',
    )
    continue
  }
  if (tab.key === 'releases') {
    llms.push('## Releases', '', `- [Releases](${SITE_URL}/releases): release notes for LearnHouse, the CLI and the npm packages`, '')
    continue
  }
  if (tab.key === 'demos') {
    llms.push('## Demos', '', `- [Demos](${SITE_URL}/demos): fifty apps built on the LearnHouse API, each with a live version and source`, '')
    continue
  }
  if (!inTab.length) continue
  llms.push(`## ${tab.label}`, '')
  for (const p of inTab) llms.push(`- [${p.title}](${p.url}.md)${p.description ? `: ${p.description}` : ''}`)
  llms.push('')
}
const other = pages.filter((p) => !TAB_DATA.some((t) => t.folders.some((f) => `/${p.slug}` === f || `/${p.slug}`.startsWith(f + '/'))))
if (other.length) {
  llms.push('## Optional', '')
  for (const p of other) llms.push(`- [${p.title}](${p.url === SITE_URL ? SITE_URL + '/index' : p.url}.md)${p.description ? `: ${p.description}` : ''}`)
  llms.push('')
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'llms.txt'), llms.join('\n'))

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
sections.push(`Base URL: ${API_BASE_URL} (all endpoints are prefixed with /api/v1).`)
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
    session: 'Auth: user session only (API tokens are rejected).',
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
    sections.push(`- ${method} ${opPath}: ${op.summary || ''}${params ? ` Params: ${params}.` : ''}${body}${right}`)
  }
  sections.push('')
}

fs.writeFileSync(OUTPUT_FILE, sections.join('\n'))
console.log(`Generated llms.txt and llms-full.txt (${pages.length} pages + API reference)`)
