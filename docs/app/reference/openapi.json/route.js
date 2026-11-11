import { getSpec } from '../../../lib/reference/fetch-spec'

export const revalidate = 3600
export const dynamic = 'force-static'

// The OpenAPI document the reference is built from. The API only serves its
// own copy in development, so the docs publish this one.
export async function GET() {
  return Response.json(await getSpec(), { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } })
}
