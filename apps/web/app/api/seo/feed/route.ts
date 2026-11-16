import { NextRequest } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { FEED_CONTENT_TYPES, buildFeed, buildPodcastRss, podcastGuid, type FeedDoc, type FeedFormat } from '@/lib/seo/feeds'
import { feedDocFromApi, feedUrls, podcastFeedFromApi } from '@/lib/seo/feedMapping'
import { fetchFeedData } from '@/lib/seo/publicData.server'
import { clipDescription, feedsEnabled, featureIndexable, orgLanguage } from '@/lib/seo/meta'
import { getOrgSeoConfig } from '@/lib/seo/utils'
import { badRequest, feedMedia, notFoundText, orgslugFrom, publicResponse, routeParams, requestBase } from '@/lib/seo/route.server'

/**
 * Public syndication feeds of an org, reached through the proxy:
 *   /feed.xml|.atom|.json                  what's new (courses, paths, podcasts)
 *   /courses/feed.*                         new courses
 *   /communities/feed.*                     latest threads of every open community
 *   /community/{key}/feed.*                 one community (?sort=top for top threads)
 *   /podcast/{key}/feed[.xml]               the podcast (Apple Podcasts / Spotify RSS)
 *   /live/feed.*                            upcoming public live sessions (EE)
 *   /newsletter/{key}/feed.*                a newsletter's public archive (EE)
 * Everything is anonymous: the API (and EE endpoints) only return what a
 * signed-out visitor may see.
 */
const KINDS = ['org', 'courses', 'communities', 'community', 'podcast', 'live', 'newsletter'] as const
type Kind = (typeof KINDS)[number]

const PREFIX: Record<Kind, (_key: string) => string> = {
  org: () => '/',
  courses: () => '/courses/',
  communities: () => '/communities/',
  community: (k) => `/community/${encodeURIComponent(k)}/`,
  podcast: (k) => `/podcast/${encodeURIComponent(k)}/`,
  live: () => '/live/',
  newsletter: (k) => `/newsletter/${encodeURIComponent(k)}/`,
}

async function anonJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}${path}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function liveDoc(org: any, base: string, lang: string): Promise<FeedDoc | null> {
  const sessions = await anonJson(`live_sessions/org/${org.id}?scope=upcoming&limit=50`)
  if (!Array.isArray(sessions)) return null
  return {
    title: `${org.name}: upcoming live sessions`,
    homeUrl: `${base}/live`,
    feedUrls: feedUrls(base, '/live/'),
    description: `Upcoming live sessions from ${org.name}.`,
    language: lang,
    author: org.name,
    items: sessions
      .filter((s: any) => s?.access === 'public' && s.status !== 'cancelled')
      .map((s: any) => {
        const url = `${base}/live/${String(s.live_session_uuid).replace(/^livesession_/, '')}`
        const when = s.starts_at ? new Date(s.starts_at).toUTCString() : ''
        return {
          id: url,
          title: s.title,
          url,
          summary: clipDescription(`${when ? `${when}. ` : ''}${s.description || ''}`, 500),
          published: s.creation_date,
          updated: s.update_date,
          categories: ['Live session'],
        }
      }),
  }
}

async function newsletterDoc(orgslug: string, key: string, org: any, base: string, lang: string): Promise<FeedDoc | null> {
  const [info, archive] = await Promise.all([
    anonJson(`newsletter/public/${encodeURIComponent(orgslug)}/${encodeURIComponent(key)}`),
    anonJson(`newsletter/public/${encodeURIComponent(orgslug)}/${encodeURIComponent(key)}/archive`),
  ])
  if (!archive?.issues) return null
  const name = info?.name || info?.newsletter?.name || key
  const home = `${base}/newsletter/${encodeURIComponent(key)}`
  return {
    title: `${name} · ${org.name}`,
    homeUrl: `${home}/archive`,
    feedUrls: feedUrls(base, `/newsletter/${encodeURIComponent(key)}/`),
    description: clipDescription(info?.description || info?.newsletter?.description || `Past issues of ${name}.`, 400),
    language: lang,
    author: org.name,
    items: archive.issues.map((i: any) => {
      const url = `${home}/archive/${encodeURIComponent(i.campaign_uuid)}`
      // Paid issues: the subject is the public teaser (as on the archive page), nothing more.
      return { id: url, title: i.subject, url, summary: i.locked ? undefined : i.preheader || undefined, published: i.sent_at, updated: i.sent_at }
    }),
  }
}

export async function GET(request: NextRequest) {
  const orgslug = orgslugFrom(request)
  if (!orgslug) return badRequest('Missing org context')
  const params = routeParams(request)
  const kind = (params.get('kind') || 'org') as Kind
  const key = params.get('key') || ''
  const format = (['rss', 'atom', 'json'].includes(params.get('format') || '') ? params.get('format') : 'rss') as FeedFormat
  const sort = params.get('sort') === 'top' ? 'top' : 'new'
  if (!KINDS.includes(kind)) return notFoundText()
  if ((kind === 'community' || kind === 'podcast' || kind === 'newsletter') && !key) return notFoundText()

  const base = requestBase(request)
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 300, tags: ['organizations'] }).catch(() => null)
  if (!org) return notFoundText()
  const seo = getOrgSeoConfig(org)
  // Podcast feeds are distribution (Apple Podcasts, Spotify): always on.
  if (kind !== 'podcast' && !feedsEnabled(seo)) return notFoundText('Feeds are turned off')
  const lang = orgLanguage(org)

  if (kind === 'podcast') {
    const data = await fetchFeedData(orgslug, 'podcast', { key })
    if (!data) return notFoundText()
    const feedUrl = `${base}${PREFIX.podcast(data.resource?.key || key)}feed`
    const input = podcastFeedFromApi(data, { base, media: feedMedia, lang, feedUrl })
    input.guid = await podcastGuid(feedUrl)
    if (format !== 'rss') return publicResponse(buildFeed(format, input), FEED_CONTENT_TYPES[format])
    return publicResponse(buildPodcastRss(input), FEED_CONTENT_TYPES.rss)
  }

  let doc: FeedDoc | null
  if (kind === 'live') {
    doc = featureIndexable(seo, 'live') ? await liveDoc(org, base, lang) : null
  } else if (kind === 'newsletter') {
    doc = featureIndexable(seo, 'newsletters') ? await newsletterDoc(orgslug, key, org, base, lang) : null
  } else {
    const data = await fetchFeedData(orgslug, kind, { key, sort })
    doc = data ? feedDocFromApi(data, { base, prefix: PREFIX[kind](data.resource?.key || key), media: feedMedia, lang }) : null
  }
  if (!doc) return notFoundText()
  if (sort === 'top') doc.feedUrls = Object.fromEntries(Object.entries(doc.feedUrls).map(([f, u]) => [f, `${u}?sort=top`]))
  return publicResponse(buildFeed(format, doc), FEED_CONTENT_TYPES[format])
}
