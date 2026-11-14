// The docs engine's content layer. fumadocs-mdx compiles every page in
// content/ (body, table of contents, frontmatter, git last-modified date);
// this module turns that into routes, the navigation tree, breadcrumbs and
// previous/next links, ordered by the _meta.json files next to the pages.
import fs from 'node:fs'
import path from 'node:path'
import { docs } from '@/.source/server'

const SITE_URL = 'https://docs.learnhouse.app'

const toRoute = (filePath) => {
  const noExt = filePath.replace(/\.mdx$/, '')
  const parts = noExt.split('/')
  if (parts[parts.length - 1] === 'index') parts.pop()
  return '/' + parts.join('/')
}

const titleCase = (name) => name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

// Pages without a frontmatter description get their first paragraph, cut
// at a word boundary, so every page has a meta description.
function summarize(structured) {
  const first = structured?.contents?.find((c) => c.content && c.content.length > 40)?.content ?? ''
  if (first.length <= 160) return first
  return first.slice(0, 157).replace(/\s+\S*$/, '') + '…'
}

// ── Pages ────────────────────────────────────────────────────────────────

const pages = docs.docs.map((doc) => {
  const route = toRoute(doc.info.path)
  const h1 = doc.toc.find((item) => item.depth === 1)
  return {
    route,
    slug: route === '/' ? [] : route.slice(1).split('/'),
    file: doc.info.path,
    title: doc.title || (h1 ? textOf(h1.title) : titleCase(route.split('/').pop() || 'Home')),
    description: doc.description || summarize(doc.structuredData),
    lastModified: doc.lastModified ?? null,
    body: doc.body,
    // The page's own h1 is the title, so it isn't repeated in "On this page".
    toc: doc.toc.filter((item) => item.depth > 1),
  }
})

const byRoute = new Map(pages.map((page) => [page.route, page]))

export function getPages() {
  return pages
}

export function getPage(slug = []) {
  return byRoute.get(slug.length ? '/' + slug.join('/') : '/') ?? null
}

// ── Navigation tree (from _meta.json) ─────────────────────────────────────

// _meta.json is read as-is: fumadocs' meta schema doesn't know our keys
// (titles per entry, separators, hidden items, external links).
const CONTENT_DIR = path.join(process.cwd(), 'content')
const metaByDir = new Map()
;(function readMeta(dir, route) {
  const file = path.join(dir, '_meta.json')
  if (fs.existsSync(file)) metaByDir.set(route, JSON.parse(fs.readFileSync(file, 'utf8')))
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) readMeta(path.join(dir, entry.name), route === '/' ? `/${entry.name}` : `${route}/${entry.name}`)
  }
})(CONTENT_DIR, '/')

function buildFolder(dir) {
  const childDirs = new Set()
  const childPages = new Map()
  const depth = dir === '/' ? 0 : dir.split('/').length - 1
  for (const page of pages) {
    if (page.route === dir) continue
    const rel = dir === '/' ? page.route.slice(1) : page.route.startsWith(dir + '/') ? page.route.slice(dir.length + 1) : null
    if (rel == null) continue
    const [first, ...rest] = rel.split('/')
    if (rest.length) childDirs.add(first)
    else childPages.set(first, page)
  }
  // A folder's own index page sits in the folder, not as a sibling.
  for (const name of childDirs) childPages.delete(name)

  const meta = metaByDir.get(dir) ?? {}
  const names = new Set([...childPages.keys(), ...childDirs])

  const make = (name) => {
    const value = meta[name]
    if (value && typeof value === 'object' && value.display === 'hidden') return null
    const label = typeof value === 'string' ? value : typeof value?.title === 'string' ? value.title : null
    const route = dir === '/' ? `/${name}` : `${dir}/${name}`
    if (childDirs.has(name)) {
      return {
        type: 'folder',
        route,
        name,
        title: label ?? byRoute.get(route)?.title ?? titleCase(name),
        children: buildFolder(route),
      }
    }
    const page = childPages.get(name)
    // A _meta entry with an href is an external link (e.g. the API reference).
    if (!page && value?.href) return { type: 'link', route: value.href, name, title: label ?? name }
    return page ? { type: 'page', route, name, title: label ?? page.title } : null
  }

  const items = []
  const indexPage = byRoute.get(dir)
  if (indexPage && dir !== '/') {
    items.push({ type: 'page', route: dir, name: 'index', title: typeof meta.index === 'string' ? meta.index : indexPage.title })
  }
  const used = new Set(['index'])
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'index') continue
    if (value && typeof value === 'object' && value.type === 'separator') {
      items.push({ type: 'separator', name: key, title: value.title })
      continue
    }
    if (!names.has(key) && !value?.href) continue
    const item = make(key)
    if (item) items.push(item)
    used.add(key)
  }
  for (const name of [...names].filter((n) => !used.has(n)).sort()) {
    const item = make(name)
    if (item) items.push(item)
  }
  return items
}

let tree = null

/** Top-level folders, each with its ordered children, like Nextra's docsDirectories. */
export function getTree() {
  tree ??= buildFolder('/')
  return tree
}

/** Pages in reading order (depth-first through the tree). */
function flatten(items, out = []) {
  for (const item of items) {
    if (item.type === 'page') out.push(item)
    if (item.type === 'folder') {
      if (byRoute.has(item.route)) out.push({ type: 'page', route: item.route, title: item.title })
      flatten(item.children.filter((c) => c.route !== item.route), out)
    }
  }
  return out
}

/** Previous/next pages within the same top-level folder. */
export function getNeighbours(route) {
  const top = '/' + route.split('/')[1]
  const folder = getTree().find((item) => item.route === top)
  if (!folder) return { prev: null, next: null }
  const order = flatten([folder])
  const i = order.findIndex((item) => item.route === route)
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null }
}

/** Ancestors with their titles, for breadcrumbs and BreadcrumbList JSON-LD. */
export function getBreadcrumbs(route) {
  if (route === '/') return []
  const parts = route.slice(1).split('/')
  const crumbs = []
  let items = getTree()
  for (let i = 0; i < parts.length; i++) {
    const r = '/' + parts.slice(0, i + 1).join('/')
    const node = items?.find((item) => item.route === r)
    crumbs.push({ route: r, title: node?.title ?? byRoute.get(r)?.title ?? titleCase(parts[i]) })
    items = node?.children
  }
  return crumbs
}

export { SITE_URL }
