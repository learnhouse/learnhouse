import { SeoScripts } from '@components/SEO/SeoScripts'
import { getLiveSessions } from '@ee/services/live_sessions/live_sessions'
import { getSeoContext } from '@/lib/seo/context.server'
import { breadcrumbJsonLd, eventJsonLd } from '@/lib/seo/jsonld'

/** Upcoming public live sessions as Events (Google event results). */
export default async function LiveSeo({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  if (ctx.seo.indexing_disabled || !ctx.org?.id) return null
  const sessions = await getLiveSessions(ctx.org.id, 'upcoming', undefined, { limit: 20 }).catch(() => [])
  const events = await Promise.all(
    (sessions || [])
      .filter((s: any) => s.access === 'public' && s.status !== 'cancelled')
      .map(async (s: any) =>
        eventJsonLd({
          name: s.title,
          url: await ctx.url(`/live/${String(s.live_session_uuid).replace(/^livesession_/, '')}`),
          description: s.description,
          startDate: s.starts_at,
          endDate: s.ends_at,
          org: ctx.orgRef,
          performers: s.host ? [{ name: [s.host.first_name, s.host.last_name].filter(Boolean).join(' ') || s.host.username }] : [],
          isFree: true,
        }),
      ),
  )
  return (
    <SeoScripts
      items={[
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Live sessions', url: await ctx.url('/live') },
        ]),
        ...events,
      ]}
    />
  )
}
