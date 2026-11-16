/**
 * Syndication feeds: RSS 2.0, Atom 1.0 and JSON Feed 1.1 from one neutral
 * description, plus the podcast flavour of RSS (Apple Podcasts / Spotify
 * namespaces). Pure functions: the route handler fetches and maps the data.
 */
import { xmlEscape } from './sitemap'
import { toIsoDate } from './jsonld'
import { clipDescription } from './meta'

export type FeedFormat = 'rss' | 'atom' | 'json'

export const FEED_CONTENT_TYPES: Record<FeedFormat, string> = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
}

export type FeedItem = {
  id: string
  title: string
  url: string
  summary?: string
  /** Full text as HTML (escaped by the builders). */
  contentHtml?: string
  author?: string
  published?: string | null
  updated?: string | null
  categories?: string[]
  image?: string
  enclosure?: { url: string; length: number; type: string }
  /** Podcasts only. */
  durationSeconds?: number
  episode?: number
}

export type FeedDoc = {
  title: string
  /** The HTML page this feed mirrors. */
  homeUrl: string
  /** This feed's own URL, per format. */
  feedUrls: Partial<Record<FeedFormat, string>>
  description?: string
  language?: string
  image?: string
  author?: string
  updated?: string | null
  items: FeedItem[]
}

function rfc822(value?: string | null): string | undefined {
  const iso = toIsoDate(value)
  return iso ? new Date(iso).toUTCString() : undefined
}

function latest(doc: FeedDoc): string {
  const dates = [doc.updated, ...doc.items.map((i) => i.updated || i.published)].map((d) => toIsoDate(d)).filter(Boolean) as string[]
  return dates.sort().at(-1) || new Date(0).toISOString()
}

const cdata = (html: string) => `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

/** Strip characters XML 1.0 forbids (control chars break strict parsers). */
export function xmlSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
}

const esc = (v: string | undefined | null) => xmlEscape(xmlSafe(String(v ?? '')))

export function buildRss(doc: FeedDoc): string {
  const items = doc.items
    .map((i) => {
      const parts = [
        `<title>${esc(i.title)}</title>`,
        `<link>${esc(i.url)}</link>`,
        `<guid isPermaLink="${i.id === i.url ? 'true' : 'false'}">${esc(i.id)}</guid>`,
      ]
      const date = rfc822(i.published || i.updated)
      if (date) parts.push(`<pubDate>${date}</pubDate>`)
      if (i.summary) parts.push(`<description>${esc(i.summary)}</description>`)
      if (i.contentHtml) parts.push(`<content:encoded>${cdata(xmlSafe(i.contentHtml))}</content:encoded>`)
      if (i.author) parts.push(`<dc:creator>${esc(i.author)}</dc:creator>`)
      for (const c of i.categories || []) parts.push(`<category>${esc(c)}</category>`)
      if (i.enclosure?.url) parts.push(`<enclosure url="${esc(i.enclosure.url)}" length="${Math.max(0, Math.round(i.enclosure.length || 0))}" type="${esc(i.enclosure.type)}"/>`)
      else if (i.image) parts.push(`<media:thumbnail url="${esc(i.image)}"/>`)
      return `    <item>${parts.join('')}</item>`
    })
    .join('\n')
  const self = doc.feedUrls.rss || ''
  const channel = [
    `<title>${esc(doc.title)}</title>`,
    `<link>${esc(doc.homeUrl)}</link>`,
    `<description>${esc(doc.description || doc.title)}</description>`,
    self ? `<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>` : '',
    doc.language ? `<language>${esc(doc.language)}</language>` : '',
    `<lastBuildDate>${new Date(latest(doc)).toUTCString()}</lastBuildDate>`,
    '<generator>LearnHouse</generator>',
    doc.image ? `<image><url>${esc(doc.image)}</url><title>${esc(doc.title)}</title><link>${esc(doc.homeUrl)}</link></image>` : '',
  ]
    .filter(Boolean)
    .join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    ${channel}
${items}
  </channel>
</rss>
`
}

export function buildAtom(doc: FeedDoc): string {
  const self = doc.feedUrls.atom || doc.homeUrl
  const entries = doc.items
    .map((i) => {
      const parts = [
        `<id>${esc(i.id.startsWith('http') || i.id.startsWith('urn:') ? i.id : `urn:learnhouse:${i.id}`)}</id>`,
        `<title>${esc(i.title)}</title>`,
        `<link rel="alternate" type="text/html" href="${esc(i.url)}"/>`,
        `<updated>${toIsoDate(i.updated || i.published) || latest(doc)}</updated>`,
      ]
      const published = toIsoDate(i.published)
      if (published) parts.push(`<published>${published}</published>`)
      if (i.author) parts.push(`<author><name>${esc(i.author)}</name></author>`)
      if (i.summary) parts.push(`<summary>${esc(i.summary)}</summary>`)
      if (i.contentHtml) parts.push(`<content type="html">${esc(i.contentHtml)}</content>`)
      for (const c of i.categories || []) parts.push(`<category term="${esc(c)}"/>`)
      if (i.enclosure?.url) parts.push(`<link rel="enclosure" type="${esc(i.enclosure.type)}" length="${Math.max(0, Math.round(i.enclosure.length || 0))}" href="${esc(i.enclosure.url)}"/>`)
      return `  <entry>${parts.join('')}</entry>`
    })
    .join('\n')
  const head = [
    `<id>${esc(self)}</id>`,
    `<title>${esc(doc.title)}</title>`,
    doc.description ? `<subtitle>${esc(doc.description)}</subtitle>` : '',
    `<updated>${latest(doc)}</updated>`,
    `<link rel="self" type="application/atom+xml" href="${esc(self)}"/>`,
    `<link rel="alternate" type="text/html" href="${esc(doc.homeUrl)}"/>`,
    doc.author ? `<author><name>${esc(doc.author)}</name></author>` : `<author><name>${esc(doc.title)}</name></author>`,
    doc.image ? `<logo>${esc(doc.image)}</logo>` : '',
    '<generator>LearnHouse</generator>',
  ]
    .filter(Boolean)
    .join('\n  ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"${doc.language ? ` xml:lang="${esc(doc.language)}"` : ''}>
  ${head}
${entries}
</feed>
`
}

export function buildJsonFeed(doc: FeedDoc): string {
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: doc.title,
    home_page_url: doc.homeUrl,
    ...(doc.feedUrls.json ? { feed_url: doc.feedUrls.json } : {}),
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.image ? { icon: doc.image } : {}),
    ...(doc.language ? { language: doc.language } : {}),
    ...(doc.author ? { authors: [{ name: doc.author }] } : {}),
    items: doc.items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      ...(i.contentHtml ? { content_html: i.contentHtml } : { content_text: i.summary || i.title }),
      ...(i.summary ? { summary: i.summary } : {}),
      ...(i.image ? { image: i.image } : {}),
      ...(toIsoDate(i.published) ? { date_published: toIsoDate(i.published) } : {}),
      ...(toIsoDate(i.updated) ? { date_modified: toIsoDate(i.updated) } : {}),
      ...(i.author ? { authors: [{ name: i.author }] } : {}),
      ...(i.categories?.length ? { tags: i.categories } : {}),
      ...(i.enclosure?.url
        ? {
            attachments: [
              {
                url: i.enclosure.url,
                mime_type: i.enclosure.type,
                ...(i.enclosure.length ? { size_in_bytes: i.enclosure.length } : {}),
                ...(i.durationSeconds ? { duration_in_seconds: i.durationSeconds } : {}),
              },
            ],
          }
        : {}),
    })),
  }
  return `${JSON.stringify(feed, null, 2)}\n`
}

export function buildFeed(format: FeedFormat, doc: FeedDoc): string {
  return format === 'atom' ? buildAtom(doc) : format === 'json' ? buildJsonFeed(doc) : buildRss(doc)
}

/** `HH:MM:SS` for itunes:duration. */
export function itunesDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Audio MIME type from a file name (Apple rejects a wrong enclosure type). */
export function audioMime(file: string): string {
  const ext = String(file).toLowerCase().split('?')[0].split('.').pop()
  switch (ext) {
    case 'm4a':
    case 'mp4':
      return 'audio/x-m4a'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'opus':
      return 'audio/opus'
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'webm':
      return 'audio/webm'
    default:
      return 'audio/mpeg'
  }
}

export type PodcastFeedInput = FeedDoc & {
  category?: string
  explicit?: boolean
  ownerName?: string
  ownerEmail?: string
  /** Podcast directories still need the feed; keep the page out of their search. */
  block?: boolean
  guid?: string
}

/**
 * Podcast RSS with the Apple Podcasts (itunes:) and Podcasting 2.0
 * (podcast:) namespaces: artwork, category, explicit flag, owner, per-episode
 * enclosure with byte length and type, guid, duration and episode number.
 */
export function buildPodcastRss(doc: PodcastFeedInput): string {
  const items = doc.items
    .map((i) => {
      const parts = [
        `<title>${esc(i.title)}</title>`,
        `<link>${esc(i.url)}</link>`,
        `<guid isPermaLink="false">${esc(i.id)}</guid>`,
      ]
      const date = rfc822(i.published)
      if (date) parts.push(`<pubDate>${date}</pubDate>`)
      const summary = i.summary || ''
      parts.push(`<description>${cdata(xmlSafe(summary))}</description>`)
      if (i.enclosure?.url) parts.push(`<enclosure url="${esc(i.enclosure.url)}" length="${Math.max(0, Math.round(i.enclosure.length || 0))}" type="${esc(i.enclosure.type)}"/>`)
      if (i.durationSeconds) parts.push(`<itunes:duration>${itunesDuration(i.durationSeconds)}</itunes:duration>`)
      if (i.episode) parts.push(`<itunes:episode>${Math.round(i.episode)}</itunes:episode>`)
      parts.push('<itunes:episodeType>full</itunes:episodeType>')
      parts.push(`<itunes:explicit>${doc.explicit ? 'true' : 'false'}</itunes:explicit>`)
      if (i.image) parts.push(`<itunes:image href="${esc(i.image)}"/>`)
      return `    <item>${parts.join('')}</item>`
    })
    .join('\n')
  const category = doc.category || 'Education'
  const channel = [
    `<title>${esc(doc.title)}</title>`,
    `<link>${esc(doc.homeUrl)}</link>`,
    doc.feedUrls.rss ? `<atom:link href="${esc(doc.feedUrls.rss)}" rel="self" type="application/rss+xml"/>` : '',
    `<description>${cdata(xmlSafe(doc.description || doc.title))}</description>`,
    `<language>${esc(doc.language || 'en')}</language>`,
    `<lastBuildDate>${new Date(latest(doc)).toUTCString()}</lastBuildDate>`,
    '<generator>LearnHouse</generator>',
    `<itunes:author>${esc(doc.author || doc.ownerName || doc.title)}</itunes:author>`,
    `<itunes:summary>${esc(clipDescription(doc.description || doc.title, 4000))}</itunes:summary>`,
    `<itunes:type>episodic</itunes:type>`,
    `<itunes:explicit>${doc.explicit ? 'true' : 'false'}</itunes:explicit>`,
    `<itunes:category text="${esc(category)}"/>`,
    `<itunes:owner><itunes:name>${esc(doc.ownerName || doc.author || doc.title)}</itunes:name>${doc.ownerEmail ? `<itunes:email>${esc(doc.ownerEmail)}</itunes:email>` : ''}</itunes:owner>`,
    doc.image ? `<itunes:image href="${esc(doc.image)}"/>` : '',
    doc.image ? `<image><url>${esc(doc.image)}</url><title>${esc(doc.title)}</title><link>${esc(doc.homeUrl)}</link></image>` : '',
    doc.block ? '<itunes:block>Yes</itunes:block>' : '',
    doc.guid ? `<podcast:guid>${esc(doc.guid)}</podcast:guid>` : '',
  ]
    .filter(Boolean)
    .join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    ${channel}
${items}
  </channel>
</rss>
`
}

/**
 * Podcasting 2.0 GUID: a UUIDv5 of the feed URL without scheme and trailing
 * slashes (namespace ead4c236-bf58-58c6-a2c6-a6b28d128cb6), so every app
 * derives the same id from the feed.
 */
export async function podcastGuid(feedUrl: string): Promise<string> {
  const name = feedUrl.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  const ns = 'ead4c236bf5858c6a2c6a6b28d128cb6'
  const nsBytes = new Uint8Array(ns.match(/../g)!.map((h) => parseInt(h, 16)))
  const nameBytes = new TextEncoder().encode(name)
  const data = new Uint8Array(nsBytes.length + nameBytes.length)
  data.set(nsBytes)
  data.set(nameBytes, nsBytes.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
