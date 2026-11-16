/**
 * API feed data (`/seo/feed/...`) → the neutral FeedDoc the builders render.
 * Pure: media URL helpers come in through `media` so tests stay offline.
 */
import type { FeedDoc, FeedFormat, FeedItem, PodcastFeedInput } from './feeds'
import { audioMime } from './feeds'
import { clipDescription, prosemirrorText } from './meta'

export type FeedMedia = {
  course: (_orgUuid: string, _uuid: string, _file: string) => string
  path: (_orgUuid: string, _uuid: string, _file: string) => string
  podcast: (_orgUuid: string, _uuid: string, _file: string) => string
  community: (_orgUuid: string, _uuid: string, _file: string) => string
  episodeImage: (_orgUuid: string, _podcastUuid: string, _episodeUuid: string, _file: string) => string
  episodeAudio: (_orgUuid: string, _podcastUuid: string, _episodeUuid: string, _file: string) => string
  orgLogo: (_orgUuid: string, _file: string) => string
}

const enc = encodeURIComponent
const LABELS: Record<string, string> = { general: 'General', question: 'Q&A', idea: 'Ideas', announcement: 'Announcements', showcase: 'Show and Tell' }

/** Public feed URLs of a page, per format (`/feed.xml`, `/feed.atom`, `/feed.json`). */
export function feedUrls(base: string, prefix: string): Record<FeedFormat, string> {
  return { rss: `${base}${prefix}feed.xml`, atom: `${base}${prefix}feed.atom`, json: `${base}${prefix}feed.json` }
}

function image(media: FeedMedia, orgUuid: string, type: string, uuid: string, file?: string): string | undefined {
  if (!file || file.includes('/')) return undefined
  const fn = (media as any)[type]
  return typeof fn === 'function' ? fn(orgUuid, uuid, file) : undefined
}

function threadItem(base: string, t: any): FeedItem {
  const url = `${base}/community/${enc(t.community_key)}/${t.segment}`
  return {
    id: url,
    title: t.title,
    url,
    summary: clipDescription(prosemirrorText(t.content, 1200), 500) || undefined,
    author: t.author || undefined,
    published: t.published,
    updated: t.updated,
    categories: [LABELS[t.label] || t.label, t.community_name].filter(Boolean),
  }
}

export function feedDocFromApi(data: any, opts: { base: string; prefix: string; media: FeedMedia; lang?: string }): FeedDoc {
  const { base, media } = opts
  const org = data.org || {}
  const orgUuid = org.org_uuid || ''
  const logo = org.logo ? media.orgLogo(orgUuid, org.logo) : undefined
  const common = { feedUrls: feedUrls(base, opts.prefix), language: opts.lang, author: org.name }
  switch (data.kind) {
    case 'communities':
      return {
        ...common,
        title: `${org.name}: ${data.sort === 'top' ? 'top discussions' : 'latest discussions'}`,
        homeUrl: `${base}/communities`,
        description: `Discussions from the ${org.name} communities.`,
        image: logo,
        items: (data.items || []).map((t: any) => threadItem(base, t)),
      }
    case 'community': {
      const r = data.resource || {}
      return {
        ...common,
        title: `${r.name}${data.sort === 'top' ? ' (top)' : ''} · ${org.name}`,
        homeUrl: `${base}/community/${enc(r.key)}`,
        description: clipDescription(r.description || `Discussions in ${r.name}.`, 400),
        image: image(media, orgUuid, 'community', r.uuid, r.image) || logo,
        updated: r.updated,
        items: (data.items || []).map((t: any) => threadItem(base, t)),
      }
    }
    default: {
      // org / courses: what's new
      const items: FeedItem[] = (data.items || []).map((i: any) => {
        const segment = i.type === 'path' ? 'path' : i.type === 'podcast' ? 'podcast' : 'course'
        const url = `${base}/${segment}/${enc(i.key)}`
        return {
          id: url,
          title: i.name,
          url,
          summary: clipDescription(i.description, 500) || undefined,
          author: i.authors?.length ? i.authors.join(', ') : undefined,
          published: i.published,
          updated: i.updated,
          categories: [segment === 'course' ? 'Course' : segment === 'path' ? 'Learning path' : 'Podcast', ...String(i.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 5)],
          image: image(media, orgUuid, segment, i.uuid, i.image),
        }
      })
      return {
        ...common,
        title: data.kind === 'courses' ? `${org.name}: courses` : `${org.name}: what's new`,
        homeUrl: data.kind === 'courses' ? `${base}/courses` : `${base}/`,
        description: clipDescription(org.description || `New courses, learning paths and podcasts from ${org.name}.`, 400),
        image: logo,
        items,
      }
    }
  }
}

/** Podcast feed data → podcast RSS input (Apple/Spotify-ready). */
export function podcastFeedFromApi(data: any, opts: { base: string; media: FeedMedia; lang?: string; feedUrl: string }): PodcastFeedInput {
  const { base, media } = opts
  const org = data.org || {}
  const p = data.resource || {}
  const orgUuid = org.org_uuid || ''
  const cover = image(media, orgUuid, 'podcast', p.uuid, p.image)
  const home = `${base}/podcast/${enc(p.key)}`
  return {
    title: p.name,
    homeUrl: home,
    feedUrls: { rss: opts.feedUrl },
    description: p.description || p.about || p.name,
    language: (p.language || opts.lang || 'en').toLowerCase(),
    image: cover,
    author: p.authors?.[0] || org.name,
    ownerName: org.name,
    category: 'Education',
    explicit: !!p.explicit,
    block: !!p.noindex,
    updated: p.updated,
    items: (data.items || []).map((e: any) => ({
      id: e.uuid,
      title: e.title,
      url: `${home}#episode-${enc(String(e.uuid).replace(/^episode_/, ''))}`,
      summary: e.description || '',
      published: e.published,
      updated: e.updated,
      durationSeconds: e.duration_seconds || undefined,
      episode: e.number || undefined,
      image: e.image && !e.image.includes('/') ? media.episodeImage(orgUuid, p.uuid, e.uuid, e.image) : cover,
      enclosure: e.audio ? { url: media.episodeAudio(orgUuid, p.uuid, e.uuid, e.audio), length: e.audio_length || 0, type: audioMime(e.audio) } : undefined,
    })),
  }
}
