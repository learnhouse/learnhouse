import { API_GROUPS, BASE_URLS, SITE_URL } from '../../../lib/reference/config'
import { getSpec } from '../../../lib/reference/fetch-spec'
import { buildOperationIndex } from '../../../lib/reference/build-model'

export const revalidate = 3600
export const dynamic = 'force-static'

/** Every documented operation as JSON (no schemas: see openapi.json for those). */
export async function GET() {
  const spec = await getSpec()
  const operations = buildOperationIndex(spec).map(({ description, ...op }) => op)
  return Response.json({
    name: 'LearnHouse API',
    version: spec.info?.version || null,
    docs: `${SITE_URL}/reference`,
    baseUrls: BASE_URLS.map(({ key, url }) => ({ key, url: `${url}/api/v1` })),
    groups: API_GROUPS.map(({ slug, title, access, rightsBucket }) => ({
      slug,
      title,
      access,
      rightsBucket,
      docs: `${SITE_URL}/reference/${slug}`,
      markdown: `${SITE_URL}/reference/llms/${slug}.md`,
    })),
    operations,
  })
}
