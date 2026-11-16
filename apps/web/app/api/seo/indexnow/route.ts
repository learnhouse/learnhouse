import { NextRequest } from 'next/server'
import { fetchIndexNowKey } from '@/lib/seo/publicData.server'
import { notFoundText, orgslugFrom, publicResponse, routeParams } from '@/lib/seo/route.server'

/**
 * `/{key}.txt` for IndexNow: search engines fetch it to check that pings for
 * this host come from its owner. Answers only for the org's current key, and
 * only while the org has IndexNow turned on.
 */
export async function GET(request: NextRequest) {
  const orgslug = orgslugFrom(request)
  const key = routeParams(request).get('key') || ''
  if (!orgslug || !/^[A-Za-z0-9-]{8,64}$/.test(key)) return notFoundText()
  const data = await fetchIndexNowKey(orgslug)
  if (!data?.key || data.key !== key) return notFoundText()
  return publicResponse(data.key, 'text/plain; charset=utf-8', { maxAge: 300, noindex: true })
}
