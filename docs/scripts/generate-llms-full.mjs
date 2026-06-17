import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(__dirname, '..', 'content')
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'llms-full.txt')
const SITE_URL = 'https://docs.learnhouse.app'

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

fs.writeFileSync(OUTPUT_FILE, sections.join('\n'))
console.log(`Generated llms-full.txt (${mdxFiles.length} pages)`)
