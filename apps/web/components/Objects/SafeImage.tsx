'use client'
import React, { useMemo } from 'react'

/**
 * Validates that a URL uses a safe protocol.
 * Only allows http:, https:, and blob: protocols to prevent XSS via javascript: or malicious data: URLs.
 */
export function isValidMediaUrl(url: string): boolean {
  if (!url) return false

  // blob: URLs from createObjectURL are safe
  if (url.startsWith('blob:')) return true

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Sanitizes a URL by validating it and returning a safe version.
 * Returns undefined if the URL is invalid or uses an unsafe protocol.
 */
export function sanitizeMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return isValidMediaUrl(url) ? url : undefined
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

  return <video src={sanitizedSrc} {...props} />
}

export default SafeImage
