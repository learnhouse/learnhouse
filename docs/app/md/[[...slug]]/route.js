import fs from 'node:fs/promises'
import path from 'node:path'
import { demoListFrom, listContentPages, mdxToMarkdown } from '@/lib/markdown/mdx-to-md.mjs'

// Every docs page as Markdown at `<route>.md` (rewritten here by next.config).
// Built once at build time; agents and "Copy page" read these.
export const dynamic = 'force-static'
export const dynamicParams = false

const CONTENT = path.join(process.cwd(), 'content')
const DEMOS = path.join(process.cwd(), 'components/headless/demos.json')

export function generateStaticParams() {
  return listContentPages(CONTENT).map((page) => ({ slug: page.slug ? page.slug.split('/') : ['index'] }))
}

export async function GET(_req, { params }) {
  const { slug = ['index'] } = await params
  const route = slug.join('/') === 'index' ? '' : slug.join('/')
  const page = listContentPages(CONTENT).find((p) => p.slug === route)
  if (!page) return new Response('Not found', { status: 404 })
  const source = await fs.readFile(page.file, 'utf8')
  const { markdown } = mdxToMarkdown(source, { demoList: () => demoListFrom(DEMOS) })
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
