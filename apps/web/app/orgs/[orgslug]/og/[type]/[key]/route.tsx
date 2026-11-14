import { ImageResponse } from 'next/og'
import { getCourseMetadata } from '@services/courses/courses'
import { getPath } from '@services/paths/paths'
import { getPodcastMeta } from '@services/podcasts/podcasts'
import { getCommunity } from '@services/communities/communities'
import { getFolderById } from '@services/folders/folders'
import { orgThemeColors } from '@/lib/theme/orgTheme'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { OG_SIZE, PAGE_CARDS, brandColor, clampText, readableOn, titleFontSize } from '@/lib/seo/ogCard'
import type { SeoResourceType } from '@/lib/seo/paths'

/**
 * Generated social card for a resource without its own image:
 * `/og/{course|path|podcast|community}/{slug-or-uuid}` (1200×630 PNG), in the
 * org's colors with its logo. Only public content is drawn; anything else
 * gets a neutral org card, so private titles never leak through an image URL.
 */

const KIND_LABEL: Record<string, string> = { course: 'Course', path: 'Learning path', podcast: 'Podcast', community: 'Community', folder: 'Collection' }
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

type Card = { kind: string; title: string; description: string; meta: string[] }

async function loadCard(type: SeoResourceType, uuid: string): Promise<Card | null> {
  switch (type) {
    case 'course': {
      const c = await getCourseMetadata(uuid.replace(/^course_/, ''), null, null, { slim: true }).catch(() => null)
      if (!c?.public || !c?.published) return null
      const lessons = (c.chapters || []).reduce((n: number, ch: any) => n + (ch.activities?.length || 0), 0)
      const authors = (c.authors || [])
        .map((a: any) => [a.user?.first_name, a.user?.last_name].filter(Boolean).join(' ') || a.user?.username)
        .filter(Boolean)
      return {
        kind: KIND_LABEL.course,
        title: c.seo?.og_title || c.name,
        description: c.seo?.og_description || c.description || '',
        meta: [
          (c.chapters || []).length ? `${c.chapters.length} chapters` : '',
          lessons ? `${lessons} lessons` : '',
          authors.length ? `By ${authors.slice(0, 2).join(', ')}` : '',
        ].filter(Boolean),
      }
    }
    case 'path': {
      const p: any = await getPath(uuid, undefined).catch(() => null)
      if (!p?.public || !p?.published) return null
      return {
        kind: KIND_LABEL.path,
        title: p.seo?.og_title || p.name,
        description: p.seo?.og_description || p.description || '',
        meta: [p.course_count ? `${p.course_count} courses` : '', p.level ? String(p.level) : '', p.certificate_enabled ? 'Certificate' : ''].filter(Boolean),
      }
    }
    case 'podcast': {
      const m = await getPodcastMeta(uuid, null).catch(() => null)
      const p = m?.podcast
      if (!p?.public || !p?.published) return null
      const episodes = (m?.episodes || []).filter((e) => e.published !== false).length
      return { kind: KIND_LABEL.podcast, title: p.seo?.og_title || p.name, description: p.seo?.og_description || p.description || '', meta: episodes ? [`${episodes} episodes`] : [] }
    }
    case 'community': {
      const c = await getCommunity(uuid, null).catch(() => null)
      if (!c?.public) return null
      return { kind: KIND_LABEL.community, title: c.seo?.og_title || c.name, description: c.seo?.og_description || c.description || '', meta: [] }
    }
    case 'folder': {
      const f: any = await getFolderById(uuid, undefined, null).catch(() => null)
      if (!f?.folder_uuid || f.public === false) return null
      const count = f.total_items ?? (f.items?.length || 0)
      return { kind: KIND_LABEL.folder, title: f.seo?.og_title || f.name, description: f.seo?.og_description || f.description || '', meta: count ? [`${count} items`] : [] }
    }
    default:
      return null
  }
}

/**
 * The org logo as a data URI. The renderer refuses to fetch private/loopback
 * addresses itself (SSRF guard), and the media host is often internal, so
 * the image is fetched here, size-capped and inlined. Null when unusable.
 */
async function logoDataUri(url?: string): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), next: { revalidate: 3600 } })
    const type = res.headers.get('content-type') || ''
    if (!res.ok || !/^image\/(png|jpeg|gif|svg\+xml)/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > 400_000) return null
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgslug: string; type: string; key: string }> }) {
  const { orgslug, type, key } = await params
  const ctx = await getSeoContext(orgslug)
  let card: Card | null = null
  if (type === 'page') {
    // Catalog pages (/courses, /paths, ...): a fixed set, so the URL can't be
    // used to render arbitrary text on the org's domain.
    const page = PAGE_CARDS[key]
    if (page) {
      const orgDescription = ctx.org?.description && ctx.org.description !== ctx.org?.name ? ctx.org.description : ''
      card = { kind: '', title: key === 'home' ? ctx.org?.name || page : page, description: orgDescription, meta: [] }
    }
  } else if (type in KIND_LABEL) {
    const resolved = await resolvePublicKey(orgslug, type as SeoResourceType, key)
    if (resolved && !resolved.restricted) card = await loadCard(type as SeoResourceType, resolved.uuid)
  }
  const org = ctx.org || {}
  // Theme brand color (theming agent's helper), falling back to the legacy one.
  const theme = orgThemeColors(org)
  const brand = brandColor(theme.brand)
  const onBrand = theme.brandText || readableOn(brand)
  const title = clampText(card?.title || org.name || 'LearnHouse', 110)
  const description = clampText(card?.description || (card ? '' : org.description) || '', 160)
  const host = ctx.base.replace(/^https?:\/\//, '')
  const logo = await logoDataUri(ctx.orgRef.logo)

  const element = (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#ffffff', fontFamily: 'sans-serif' }}>
      <div style={{ width: 24, height: '100%', background: brand, display: 'flex' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '64px 72px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" height={56} style={{ height: 56, maxWidth: 280, objectFit: 'contain' }} />
          ) : (
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#111827' }}>{org.name}</div>
          )}
          {card?.kind ? (
            <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 24, fontWeight: 600, padding: '8px 20px', borderRadius: 999, background: brand, color: onBrand }}>
              {card.kind}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', fontSize: titleFontSize(title), fontWeight: 800, color: '#111827', lineHeight: 1.1, letterSpacing: -1 }}>{title}</div>
          {description ? <div style={{ display: 'flex', fontSize: 30, color: '#4b5563', lineHeight: 1.35 }}>{description}</div> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: '#6b7280', gap: 16 }}>
          {(card?.meta || []).map((m, i) => (
            <div key={i} style={{ display: 'flex' }}>{i > 0 ? `·  ${m}` : m}</div>
          ))}
          <div style={{ display: 'flex', marginLeft: 'auto', color: '#9ca3af' }}>{host}</div>
        </div>
      </div>
    </div>
  )

  return new ImageResponse(element, { ...OG_SIZE, headers: { 'Cache-Control': CACHE } })
}
