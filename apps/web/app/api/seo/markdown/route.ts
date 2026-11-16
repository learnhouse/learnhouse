import { NextRequest } from 'next/server'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { buildLlmsTxt, canonicalPathFor, markdownFor, parseMarkdownPath } from '@/lib/seo/markdown'
import { fetchLlmsData, fetchMarkdownData } from '@/lib/seo/publicData.server'
import { llmsEnabled } from '@/lib/seo/meta'
import { getOrgSeoConfig } from '@/lib/seo/utils'
import { badRequest, notFoundText, orgslugFrom, publicResponse, routeParams, requestBase } from '@/lib/seo/route.server'

const MD = 'text/markdown; charset=utf-8'

/**
 * Markdown alternate of a public page (`/course/x.md`, `/community/c/42-t.md`,
 * `/index.md` for the home page). The API answers only for pages an
 * anonymous visitor can open and that may be indexed; everything else 404s.
 * Markdown copies are `noindex` (the HTML page is the canonical one) and
 * point back to it with a canonical Link header.
 */
export async function GET(request: NextRequest) {
  const orgslug = orgslugFrom(request)
  if (!orgslug) return badRequest('Missing org context')
  const path = routeParams(request).get('path') || ''
  const target = parseMarkdownPath(path)
  if (!target) return notFoundText()
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 300, tags: ['organizations'] }).catch(() => null)
  if (!org || !llmsEnabled(getOrgSeoConfig(org))) return notFoundText()
  const base = requestBase(request)
  let canonical = `${base}/`
  let body = ''
  if (target.type === 'home') {
    const data = await fetchLlmsData(orgslug, false)
    if (data) body = buildLlmsTxt(data, base)
  } else {
    const data = await fetchMarkdownData(orgslug, target.type, target.key, target.sub)
    const canonicalPath = canonicalPathFor(data)
    if (data && canonicalPath) {
      canonical = `${base}${canonicalPath}`
      body = markdownFor(data, { base, canonical })
    }
  }
  if (!body) return notFoundText()
  const res = publicResponse(body, MD, { maxAge: 900, noindex: true })
  res.headers.set('Link', `<${canonical}>; rel="canonical"`)
  return res
}
