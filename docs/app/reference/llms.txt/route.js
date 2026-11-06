import { getSpec } from '../../../lib/reference/fetch-spec'
import { buildOperationIndex } from '../../../lib/reference/build-model'
import { renderIndexMarkdown } from '../../../lib/reference/markdown'

export const revalidate = 3600
export const dynamic = 'force-static'

/** Markdown index of the API reference for LLMs (llms.txt convention). */
export async function GET() {
  const spec = await getSpec()
  const body = renderIndexMarkdown({ operations: buildOperationIndex(spec), version: spec.info?.version })
  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
