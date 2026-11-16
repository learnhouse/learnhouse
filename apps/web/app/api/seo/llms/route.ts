import { NextRequest } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { buildLlmsTxt } from '@/lib/seo/markdown'
import { fetchLlmsData } from '@/lib/seo/publicData.server'
import { fetchSitemapData } from '@/lib/seo/sitemapData.server'
import { featureIndexable, llmsEnabled } from '@/lib/seo/meta'
import { getOrgSeoConfig } from '@/lib/seo/utils'
import { badRequest, notFoundText, orgslugFrom, publicResponse, routeParams, requestBase } from '@/lib/seo/route.server'

/**
 * `/llms.txt` and `/llms-full.txt` (llmstxt.org) of an org: a Markdown map of
 * its public content for AI assistants and answer engines. Off when the org
 * hides itself from search, turns llms.txt off, or blocks all AI agents.
 */
export async function GET(request: NextRequest) {
  const orgslug = orgslugFrom(request)
  if (!orgslug) return badRequest('Missing org context')
  const full = routeParams(request).get('full') === '1'
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 300, tags: ['organizations'] }).catch(() => null)
  if (!org) return notFoundText()
  const seo = getOrgSeoConfig(org)
  if (!llmsEnabled(seo)) return notFoundText()
  const base = requestBase(request)
  const [data, sitemap] = await Promise.all([fetchLlmsData(orgslug, full), fetchSitemapData(orgslug)])
  if (!data) return new Response('Temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } })

  const extra: { title: string; links: { name: string; url: string; note?: string }[] }[] = []
  if (sitemap?.pages?.length) {
    extra.push({ title: 'Pages', links: sitemap.pages.map((p: any) => ({ name: p.name, url: `${base}/p/${encodeURIComponent(p.key)}` })) })
  }
  if (featureIndexable(seo, 'live') && org.id) {
    try {
      const res = await fetch(`${getServerAPIUrl()}live_sessions/org/${org.id}?scope=upcoming&limit=50`, {
        next: { revalidate: 600 },
        signal: AbortSignal.timeout(4000),
      })
      const sessions = res.ok ? await res.json() : []
      const open = Array.isArray(sessions) ? sessions.filter((s: any) => s?.access === 'public' && s.status !== 'cancelled') : []
      if (open.length) {
        extra.push({
          title: 'Upcoming live sessions',
          links: open.map((s: any) => ({
            name: s.title,
            url: `${base}/live/${String(s.live_session_uuid).replace(/^livesession_/, '')}`,
            note: [s.starts_at ? new Date(s.starts_at).toISOString().replace(/\.\d+Z$/, 'Z') : '', s.description || ''].filter(Boolean).join(' · '),
          })),
        })
      }
    } catch {
      // Live sessions are an extra; llms.txt still serves without them.
    }
  }
  return publicResponse(buildLlmsTxt(data, base, { full, extra }), 'text/plain; charset=utf-8', { maxAge: 3600 })
}
