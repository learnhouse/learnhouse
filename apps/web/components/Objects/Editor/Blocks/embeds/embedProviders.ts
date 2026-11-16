/*
 Paste a link, get the right embed.

 Turns a share/watch URL from a known service into the URL its iframe player
 expects, plus a sensible frame shape. Used when an author pastes a link on an
 empty line and inside the Embed block. Pure module, unit tested.

 Unknown links return null: the caller keeps them as plain links (paste) or
 iframes them as-is (the Embed block's "any URL" mode, unchanged behaviour).
*/
import { toEmbedUrl, vimeoId, youTubeId } from '@/lib/media/embedUrl'

export type EmbedProviderId =
  | 'youtube'
  | 'vimeo'
  | 'loom'
  | 'figma'
  | 'google-docs'
  | 'google-sheets'
  | 'google-slides'
  | 'google-forms'
  | 'google-drive'
  | 'google-maps'
  | 'codepen'
  | 'codesandbox'
  | 'spotify'
  | 'soundcloud'
  | 'miro'
  | 'canva'
  | 'desmos'
  | 'geogebra'

export interface ParsedEmbed {
  provider: EmbedProviderId
  /** Human name, shown on chips and as the iframe title. */
  label: string
  /** What goes into the iframe `src`. */
  embedUrl: string
  /** width / height; null means a fixed pixel height (see `height`). */
  aspect: number | null
  height: number | null
  /** The link as the author pasted it (normalized). */
  sourceUrl: string
}

export const ASPECT_PRESETS = [
  { id: '16:9', value: 16 / 9 },
  { id: '4:3', value: 4 / 3 },
  { id: '1:1', value: 1 },
  { id: '9:16', value: 9 / 16 },
] as const

/** Closest preset id for a stored ratio, or null for custom/none. */
export function aspectPresetFor(ratio: number | null | undefined): string | null {
  if (!ratio || !Number.isFinite(ratio)) return null
  const hit = ASPECT_PRESETS.find((p) => Math.abs(p.value - ratio) < 0.01)
  return hit ? hit.id : null
}

/**
 * Accept what people actually paste ("youtube.com/watch?v=…", a URL with
 * spaces around it) and refuse anything that isn't http(s).
 */
export function normalizeUserUrl(input: string): string | null {
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

/** Seconds from YouTube's t / start params: "90", "90s", "1m30s", "1h2m3s". */
export function parseYouTubeTime(value: string | null): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10)
}

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '')

export function parseEmbedUrl(input: string): ParsedEmbed | null {
  const sourceUrl = normalizeUserUrl(input)
  if (!sourceUrl) return null
  let u: URL
  try {
    u = new URL(sourceUrl)
  } catch {
    return null
  }
  const host = hostOf(u)
  const path = u.pathname
  const make = (
    provider: EmbedProviderId,
    label: string,
    embedUrl: string,
    aspect: number | null,
    height: number | null = null,
  ): ParsedEmbed => ({ provider, label, embedUrl, aspect, height, sourceUrl })

  // YouTube (watch, youtu.be, shorts, embed, live), keeping a start time.
  const yt = youTubeId(sourceUrl)
  if (yt && /^[\w-]{11}$/.test(yt)) {
    const start = parseYouTubeTime(u.searchParams.get('t') || u.searchParams.get('start'))
    const isShort = path.startsWith('/shorts/')
    const params = new URLSearchParams({ rel: '0' })
    if (start) params.set('start', String(start))
    return make('youtube', 'YouTube', `https://www.youtube.com/embed/${yt}?${params}`, isShort ? 9 / 16 : 16 / 9)
  }

  if (vimeoId(sourceUrl)) return make('vimeo', 'Vimeo', toEmbedUrl(sourceUrl), 16 / 9)

  if (host === 'loom.com' && /^\/(share|embed)\//.test(path)) {
    const id = path.split('/')[2]
    if (id) return make('loom', 'Loom', `https://www.loom.com/embed/${id}`, 16 / 9)
  }

  if (host === 'figma.com' && /^\/(file|design|proto|board|slides)\//.test(path)) {
    return make('figma', 'Figma', toEmbedUrl(sourceUrl.replace(/^http:/, 'https:')), 16 / 9)
  }

  if (host === 'docs.google.com') {
    const m = path.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([\w-]+)/)
    if (m) {
      const [, kind, published, id] = m
      const base = `https://docs.google.com/${kind}/d/${published ? 'e/' : ''}${id}`
      if (kind === 'presentation') {
        return make('google-slides', 'Google Slides', `${base}/${published ? 'embed' : 'preview'}`, 16 / 9)
      }
      if (kind === 'forms') return make('google-forms', 'Google Forms', `${base}/viewform?embedded=true`, null, 800)
      if (kind === 'spreadsheets') return make('google-sheets', 'Google Sheets', `${base}/${published ? 'pubhtml?widget=true' : 'preview'}`, null, 560)
      return make('google-docs', 'Google Docs', `${base}/${published ? 'pub?embedded=true' : 'preview'}`, null, 720)
    }
  }

  if (host === 'drive.google.com') {
    const m = path.match(/^\/file\/d\/([\w-]+)/)
    if (m) return make('google-drive', 'Google Drive', `https://drive.google.com/file/d/${m[1]}/preview`, 4 / 3)
  }

  // Only Maps' own embed links work without an API key.
  if ((host === 'google.com' || host.endsWith('.google.com')) && path.startsWith('/maps/embed')) {
    return make('google-maps', 'Google Maps', sourceUrl, 4 / 3)
  }

  if (host === 'codepen.io') {
    const m = path.match(/^\/([\w-]+)\/(?:pen|embed|full|details)\/(\w+)/)
    if (m) return make('codepen', 'CodePen', `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, null, 420)
  }

  if (host === 'codesandbox.io') {
    const m = path.match(/^\/(?:s|embed|p\/sandbox|p\/devbox)\/([\w-]+)/)
    if (m) return make('codesandbox', 'CodeSandbox', `https://codesandbox.io/embed/${m[1]}`, null, 500)
  }

  if (host === 'open.spotify.com') {
    const m = path.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/)
    if (m) {
      const compact = m[1] === 'track' || m[1] === 'episode'
      return make('spotify', 'Spotify', `https://open.spotify.com/embed/${m[1]}/${m[2]}`, null, compact ? 152 : 352)
    }
  }

  if (host === 'soundcloud.com' && path.split('/').filter(Boolean).length >= 2) {
    return make(
      'soundcloud',
      'SoundCloud',
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(sourceUrl)}&visual=false`,
      null,
      166,
    )
  }

  if (host === 'miro.com' && path.startsWith('/app/board/')) {
    return make('miro', 'Miro', toEmbedUrl(sourceUrl), 4 / 3)
  }

  if (host === 'canva.com' && path.includes('/design/')) {
    return make('canva', 'Canva', toEmbedUrl(sourceUrl), 16 / 9)
  }

  if (host === 'desmos.com' && path.startsWith('/calculator')) {
    const embed = `https://www.desmos.com${path}${u.search ? `${u.search}&` : '?'}embed`
    return make('desmos', 'Desmos', embed, 4 / 3)
  }

  if (host === 'geogebra.org') {
    const m = path.match(/^\/(?:m|material\/show\/id|classic)\/(\w+)/)
    if (m) return make('geogebra', 'GeoGebra', `https://www.geogebra.org/material/iframe/id/${m[1]}`, 4 / 3)
  }

  return null
}

/**
 * The frame size attrs to store on a blockEmbed for a parsed link. Matches the
 * node's existing attrs (embedAspectRatio / embedHeight) so learners render it
 * with the code path that already exists.
 */
export function embedAttrsFor(parsed: ParsedEmbed) {
  return {
    embedType: 'url',
    embedUrl: parsed.embedUrl,
    embedSourceUrl: parsed.sourceUrl,
    embedProvider: parsed.provider,
    embedAspectRatio: parsed.aspect,
    embedHeight: parsed.height ?? 300,
  }
}
