'use client'
import React, { useMemo } from 'react'

// Allowlist of safe URL protocols
const SAFE_PROTOCOLS = ['http:', 'https:', 'blob:'] as const

/**
 * Validates that a URL uses a safe protocol.
 * Only allows http:, https:, and blob: protocols to prevent XSS via javascript: or malicious data: URLs.
 */
export function isValidMediaUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false

  // blob: URLs from createObjectURL are safe
  if (url.startsWith('blob:')) return true

  try {
    const parsed = new URL(url)
    return SAFE_PROTOCOLS.includes(parsed.protocol as typeof SAFE_PROTOCOLS[number])
  } catch {
    return false
  }
}

/**
 * Sanitizes a URL by validating it and returning a safe version.
 * Returns undefined if the URL is invalid or uses an unsafe protocol.
 */
export function sanitizeMediaUrl(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  if (!isValidMediaUrl(url)) return undefined

  // Additional safety: ensure no unexpected characters that could break out of attributes
  // This is defense-in-depth; React already escapes attribute values
  if (url.includes('<') || url.includes('>')) return undefined

  return url
}

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined
}

/**
 * A safe image component that validates URLs before rendering.
 * Only renders images with safe protocols (http:, https:, blob:).
 */
export function SafeImage({ src, alt, ...props }: SafeImageProps) {
  const sanitizedSrc = useMemo(() => sanitizeMediaUrl(src), [src])

  if (!sanitizedSrc) {
    return null
  }

  // lgtm[js/xss-through-dom] - URL is sanitized above, only safe protocols allowed
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={sanitizedSrc} alt={alt} {...props} />
}

interface SafeVideoProps extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  src: string | null | undefined
}

/**
 * A safe video component that validates URLs before rendering.
 * Only renders videos with safe protocols (http:, https:, blob:).
 */
export function SafeVideo({ src, ...props }: SafeVideoProps) {
  const sanitizedSrc = useMemo(() => sanitizeMediaUrl(src), [src])

  if (!sanitizedSrc) {
    return null
  }

  // lgtm[js/xss-through-dom] - URL is sanitized above, only safe protocols allowed
  return <video src={sanitizedSrc} {...props} />
}

export default SafeImage
