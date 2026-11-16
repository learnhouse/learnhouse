/*
 Pure helpers for the Web preview block (no React), unit tested in
 tests/editor-blocks-embeds.test.mjs.

 Stored attrs: the page's own metadata (title, description, og_image, favicon,
 og_type, og_url) as fetched, plus optional author overrides (customTitle,
 customDescription) so "Refresh metadata" never throws away what the author
 wrote. Blocks saved before the overrides existed have none and read exactly
 as before.
*/
import { safeExternalUrl, safeImageSrc } from '../../../../../services/security/url'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'

export type PreviewLayout = 'large' | 'compact'
export type PreviewAlign = 'left' | 'center' | 'right'

/** The metadata fields the link-preview endpoint fills (and Refresh rewrites). */
export const METADATA_KEYS = ['title', 'description', 'og_image', 'favicon', 'og_type', 'og_url'] as const

export function previewLayoutOf(value: unknown): PreviewLayout {
  return value === 'compact' ? 'compact' : 'large'
}

export function previewAlignOf(value: unknown): PreviewAlign {
  return value === 'center' || value === 'right' ? value : 'left'
}

export function hostnameOf(url: string | null | undefined): string {
  const safe = safeExternalUrl(url || '')
  if (!safe) return ''
  try {
    return new URL(safe).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * What the card shows. An override wins; otherwise the page's own text. A
 * title that is just the URL (the LMS importer writes that when it has nothing
 * better) reads as the hostname, which is what a person would write.
 */
export function previewTextOf(attrs: Record<string, any>): { title: string; description: string; host: string } {
  const host = hostnameOf(attrs?.url)
  const custom = clean(attrs?.customTitle)
  let title = custom || clean(attrs?.title)
  if (!custom && title && (title === clean(attrs?.url) || safeExternalUrl(title) === safeExternalUrl(attrs?.url))) title = host || title
  const description = clean(attrs?.customDescription) || clean(attrs?.description)
  return { title: title || host, description, host }
}

/** Only the known metadata fields, cleaned, from a link-preview response. */
export function metadataAttrsFrom(data: unknown): Record<(typeof METADATA_KEYS)[number], string | null> {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const out = {} as Record<(typeof METADATA_KEYS)[number], string | null>
  for (const key of METADATA_KEYS) {
    const v = clean(d[key])
    out[key] = v || null
  }
  // Images and links come from someone else's page: keep only safe schemes.
  out.og_image = safeImageSrc(out.og_image) && /^https?:/i.test(out.og_image || '') ? out.og_image : null
  out.favicon = safeImageSrc(out.favicon) && /^https?:/i.test(out.favicon || '') ? out.favicon : null
  out.og_url = safeExternalUrl(out.og_url) ? out.og_url : null
  return out
}

/** The page told us nothing worth a card (no title, description or image). */
export function isThinMetadata(meta: Record<string, string | null>): boolean {
  return !meta.title && !meta.description && !meta.og_image
}

/** Author input → a URL we will store and link to, or null. */
export function normalizePreviewUrl(input: string): string | null {
  const url = normalizeUserUrl(input)
  return url && safeExternalUrl(url) ? url : null
}
