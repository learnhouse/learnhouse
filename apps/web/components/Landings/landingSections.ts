import type { LandingBackground, LandingSection, LandingSectionStyle } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import type { SessionStatus } from '@components/Contexts/AuthContext'
import { youTubeId, vimeoId, toEmbedUrl } from '@/lib/media/embedUrl'

/**
 * Whether a landing section should render for the current visitor.
 *
 * Audience-restricted sections stay hidden while the session is still
 * loading, so a signed-in learner never sees the visitor-only hero flash by.
 */
export function isSectionVisible(section: LandingSection, status: SessionStatus, now: Date = new Date()): boolean {
  if (section.hidden) return false
  if (!isWithinSchedule(section, now)) return false
  const visibility = section.visibility || 'everyone'
  if (visibility === 'everyone') return true
  if (status === 'loading') return false
  return visibility === 'logged_in'
    ? status === 'authenticated'
    : status === 'unauthenticated'
}

/** A missing or unparseable bound is treated as open, so a typo never blanks a section. */
export function isWithinSchedule(section: Pick<LandingSection, 'showFrom' | 'showUntil'>, now: Date): boolean {
  const from = section.showFrom ? Date.parse(section.showFrom) : NaN
  const until = section.showUntil ? Date.parse(section.showUntil) : NaN
  if (!Number.isNaN(from) && now.getTime() < from) return false
  if (!Number.isNaN(until) && now.getTime() >= until) return false
  return true
}

export type LandingVideoSource =
  | { kind: 'embed'; src: string }
  | { kind: 'file'; src: string }
  | null

/**
 * Only known video hosts become an iframe. Anything else http(s) is treated
 * as a video file, so an arbitrary page can never be framed on the landing.
 */
export function resolveLandingVideo(url: string): LandingVideoSource {
  const trimmed = (url || '').trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  const isLoom = /^https?:\/\/www\.loom\.com\/(share|embed)\//.test(trimmed)
  if (youTubeId(trimmed) || vimeoId(trimmed) || isLoom) {
    return { kind: 'embed', src: toEmbedUrl(trimmed) }
  }
  return { kind: 'file', src: trimmed }
}

/** CSS `background` for a landing background, or undefined when nothing usable is set. */
export function backgroundCss(background?: LandingBackground): string | undefined {
  if (!background) return undefined
  if (background.type === 'solid') return background.color || undefined
  if (background.type === 'gradient') {
    const colors = (background.colors || []).filter(Boolean)
    if (colors.length < 2) return undefined
    return `linear-gradient(${background.direction || '45deg'}, ${colors.join(', ')})`
  }
  if (background.type === 'image' && background.image) {
    return `url(${JSON.stringify(background.image)}) center/cover`
  }
  return undefined
}

const SPACING_CLASSES = {
  none: 'py-0',
  small: 'py-6',
  medium: 'py-16',
  large: 'py-28',
} as const

/** Vertical padding class for a section. 'medium' matches the historical py-16. */
export function spacingClass(style?: LandingSectionStyle): string {
  return SPACING_CLASSES[style?.spacing || 'medium'] || SPACING_CLASSES.medium
}

/** Turn free text into a safe element id ("Our Pricing!" -> "our-pricing"). */
export function sanitizeAnchor(anchor?: string): string | undefined {
  const id = (anchor || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || undefined
}

/** True when a section carries presentation settings that need a wrapper element. */
export function hasSectionFrame(style?: LandingSectionStyle): boolean {
  if (!style) return false
  return Boolean(
    backgroundCss(style.background) ||
      style.textColor ||
      sanitizeAnchor(style.anchor) ||
      style.width === 'narrow' ||
      style.titleAlign === 'center' ||
      (style.animation && style.animation !== 'none')
  )
}

/** Tailwind classes that show a section on one device class only. */
export function deviceClass(device?: LandingSection['device']): string {
  if (device === 'desktop') return 'hidden md:flex'
  if (device === 'mobile') return 'flex md:hidden'
  return ''
}

// Hosts that may be framed by the Embed section, besides the providers
// `toEmbedUrl` already knows how to rewrite. Anything else renders nothing.
const EMBED_HOSTS = [
  'calendly.com',
  'typeform.com',
  'tally.so',
  'airtable.com',
  'docs.google.com',
  'figma.com',
  'loom.com',
  'canva.com',
  'miro.com',
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
  'google.com', // maps embeds
]

/** The iframe src for an Embed section, or null when the host is not allowed. */
export function resolveLandingEmbed(url: string): string | null {
  const trimmed = (url || '').trim()
  let host: string
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  const allowed = EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  if (!allowed) return null
  if (host === 'google.com' && !trimmed.includes('/maps/embed')) return null
  return toEmbedUrl(trimmed)
}

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
  done: boolean
}

export function countdownParts(target: string, now: Date): CountdownParts {
  const end = Date.parse(target)
  const left = Number.isNaN(end) ? 0 : Math.max(0, end - now.getTime())
  const totalSeconds = Math.floor(left / 1000)
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: left === 0,
  }
}

/**
 * Links typed into the landing editor end up as hrefs on a public page. Allow
 * internal paths, in-page anchors, http(s) and mailto/tel; anything else
 * (javascript:, data:, protocol-relative) becomes an inert "#".
 */
export function safeHref(link?: string): string {
  const value = (link || '').trim()
  if (!value) return '#'
  if (value.startsWith('#')) return value
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value
  return '#'
}
