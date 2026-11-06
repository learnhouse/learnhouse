import { API_GROUPS } from '../../../../lib/reference/config'
import { getSpec } from '../../../../lib/reference/fetch-spec'
import { buildGroupDocs } from '../../../../lib/reference/build-model'
import { renderGroupMarkdown } from '../../../../lib/reference/markdown'

export const revalidate = 3600
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return API_GROUPS.map((g) => ({ file: `${g.slug}.md` }))
}

/** Full Markdown for one endpoint group: /reference/llms/<group>.md */
export async function GET(_req, { params }) {
  const { file } = await params
  const slug = String(file).replace(/\.md$/, '')
  const spec = await getSpec()
  const group = await buildGroupDocs(spec, slug)
  if (!group) return new Response('Not found', { status: 404 })
  return new Response(renderGroupMarkdown(group), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
