import { SeoScripts } from '@components/SEO/SeoScripts'
import { getLiveSession } from '@ee/services/live_sessions/live_sessions'
import { getSeoContext } from '@/lib/seo/context.server'
import { breadcrumbJsonLd, eventJsonLd } from '@/lib/seo/jsonld'

/** A public live session: Event + breadcrumbs. Members-only sessions get none. */
export default async function LiveSessionSeo({ params }: { params: Promise<{ orgslug: string; sessionuuid: string }> }) {
  const { orgslug, sessionuuid } = await params
  const ctx = await getSeoContext(orgslug)
  if (ctx.seo.indexing_disabled) return null
  const s = await getLiveSession(sessionuuid.startsWith('livesession_') ? sessionuuid : `livesession_${sessionuuid}`).catch(() => null)
  if (!s || s.access !== 'public') return null
  const url = await ctx.url(`/live/${sessionuuid.replace(/^livesession_/, '')}`)
  return (
    <SeoScripts
      items={[
        eventJsonLd({
          name: s.title,
          url,
          description: s.description,
          startDate: s.starts_at,
          endDate: s.ends_at,
          org: ctx.orgRef,
          performers: s.host ? [{ name: [s.host.first_name, s.host.last_name].filter(Boolean).join(' ') || s.host.username }] : [],
          cancelled: s.status === 'cancelled',
          isFree: true,
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Live sessions', url: await ctx.url('/live') },
          { name: s.title, url },
        ]),
      ]}
    />
  )
}
