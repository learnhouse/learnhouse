import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pagefind from 'pagefind'

// Builds the search index from the prerendered pages.
//
// A plain `next build` writes them to .next/server/app/<route>.html. When a
// deployment adapter is active (Vercel sets NEXT_ADAPTER_PATH), Next 16.3.5+
// writes them to .next/server/route-cache/APP_PAGE/<hash>/$/<route>.html
// instead, and `pagefind --site .next/server/app` finds nothing. Both layouts
// are read here, and each page is indexed under its route so search results
// link to the same URLs either way.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.join(__dirname, '..', '.next', 'server')
const OUTPUT_PATH = path.join(__dirname, '..', 'public', '_pagefind')

function walkHtml(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

function collectPages() {
  const pages = new Map()

  const appDir = path.join(SERVER_DIR, 'app')
  for (const file of walkHtml(appDir)) {
    pages.set(path.relative(appDir, file), file)
  }

  const routeCacheDir = path.join(SERVER_DIR, 'route-cache', 'APP_PAGE')
  for (const file of walkHtml(routeCacheDir)) {
    const [, route] = path.relative(routeCacheDir, file).split(`${path.sep}$${path.sep}`)
    if (route) pages.set(route, file)
  }

  return pages
}

const pages = collectPages()
if (pages.size === 0) {
  console.error(`No prerendered HTML found under ${SERVER_DIR}`)
  process.exit(1)
}

const { index, errors } = await pagefind.createIndex()
if (errors.length) throw new Error(errors.join('\n'))

for (const [route, file] of pages) {
  const result = await index.addHTMLFile({
    sourcePath: route.split(path.sep).join('/'),
    content: fs.readFileSync(file, 'utf8'),
  })
  if (result.errors.length) throw new Error(`${route}: ${result.errors.join('\n')}`)
}

const written = await index.writeFiles({ outputPath: OUTPUT_PATH })
if (written.errors.length) throw new Error(written.errors.join('\n'))

await pagefind.close()
console.log(`Pagefind indexed ${pages.size} pages into public/_pagefind`)
