/*
 Which service a video link comes from, and the providers that can play it.

 Built in: YouTube, Vimeo and Loom. Anything else comes from the provider list
 in `@ee/components/Video/videoProviders` (empty in the open-source build).
 Pure apart from that list, unit tested.
*/
import { EE_VIDEO_PROVIDERS } from '@ee/components/Video/videoProviders'
import { vimeoHash, vimeoId, youTubeId } from '@/lib/media/embedUrl'
import type { VideoLinkMatch, VideoProvider } from './types'

export type { VideoLinkMatch, VideoProvider, ExternalPlayerProps, VideoPlayerControls } from './types'

export const BUILT_IN_VIDEO_PROVIDERS = ['youtube', 'vimeo', 'loom'] as const

const BUILT_IN_LABELS: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom' }

/** Providers registered on top of the built-in ones. */
export function extraVideoProviders(): VideoProvider[] {
  return Array.isArray(EE_VIDEO_PROVIDERS) ? EE_VIDEO_PROVIDERS : []
}

/** The registered provider with this id, or null (built-ins have no entry). */
export function findVideoProvider(id: string | null | undefined): VideoProvider | null {
  if (!id) return null
  return extraVideoProviders().find((p) => p.id === id) || null
}

/** Whether a stored provider id is a video service we know how to label. */
export function isVideoProvider(id: string | null | undefined): boolean {
  return !!id && ((BUILT_IN_VIDEO_PROVIDERS as readonly string[]).includes(id) || !!findVideoProvider(id))
}

/** Badge text for a provider id; the id itself when unknown. */
export function videoProviderLabel(id: string | null | undefined): string {
  if (!id) return ''
  return BUILT_IN_LABELS[id] || findVideoProvider(id)?.label || id
}

/** Names of every service a video link can come from, for hints. */
export function videoServiceNames(): string {
  return ['YouTube', 'Vimeo', 'Loom', ...extraVideoProviders().map((p) => p.label)].join(', ')
}

function normalize(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** The video a pasted link points to, from a built-in or registered service. */
export function detectVideoLink(input: string): VideoLinkMatch | null {
  const sourceUrl = normalize(input)
  if (!sourceUrl) return null
  const yt = youTubeId(sourceUrl)
  if (yt && /^[\w-]{11}$/.test(yt)) {
    return { provider: 'youtube', label: 'YouTube', videoId: yt, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`, sourceUrl }
  }
  const vimeo = vimeoId(sourceUrl)
  if (vimeo) {
    const hash = vimeoHash(sourceUrl, vimeo)
    return {
      provider: 'vimeo',
      label: 'Vimeo',
      videoId: vimeo,
      embedUrl: `https://player.vimeo.com/video/${vimeo}${hash ? `?h=${hash}` : ''}`,
      sourceUrl,
    }
  }
  const u = new URL(sourceUrl)
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const loom = host === 'loom.com' ? u.pathname.match(/^\/(?:share|embed)\/([\w-]+)/) : null
  if (loom) {
    return { provider: 'loom', label: 'Loom', videoId: loom[1], embedUrl: `https://www.loom.com/embed/${loom[1]}`, sourceUrl }
  }
  for (const provider of extraVideoProviders()) {
    try {
      const hit = provider.match(sourceUrl)
      if (hit) return hit
    } catch {
      /* a provider's parser must never break the paste */
    }
  }
  return null
}

const clampSeconds = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null

/**
 * The embed URL with a trim applied the way each service's own player reads
 * it, so even renderers that ignore the start/end attrs honour the trim.
 * Services without an end parameter only get the start.
 */
export function withTrim(embedUrl: string, provider: string | null | undefined, start?: number | null, end?: number | null): string {
  let u: URL
  try {
    u = new URL(embedUrl)
  } catch {
    return embedUrl
  }
  const s = clampSeconds(start)
  const e = clampSeconds(end)
  const endOk = e != null && (s == null || e > s) ? e : null
  if (provider === 'youtube') {
    u.searchParams.delete('start')
    u.searchParams.delete('end')
    if (s) u.searchParams.set('start', String(s))
    if (endOk) u.searchParams.set('end', String(endOk))
    return u.toString()
  }
  if (provider === 'vimeo') {
    u.hash = s ? `t=${s}s` : ''
    return u.toString()
  }
  // Loom and the registered players read `t` (seconds) for the start.
  u.searchParams.delete('t')
  if (s) u.searchParams.set('t', String(s))
  return u.toString()
}
