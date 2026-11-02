'use client'
import React from 'react'
import { getOrgLogoMediaDirectory, getOrgSquareLogoMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'

/**
 * The square logo lives on the org config (next to the favicon) rather than
 * on the org row, so it is read from either config shape.
 */
export function getOrgSquareLogoFile(org: any): string {
  return (
    org?.config?.config?.customization?.general?.square_logo_image ||
    org?.config?.config?.general?.square_logo_image ||
    ''
  )
}

export function getOrgSquareLogoUrl(org: any): string | null {
  const file = getOrgSquareLogoFile(org)
  return file && org?.org_uuid ? getOrgSquareLogoMediaDirectory(org.org_uuid, file) : null
}

export function getOrgWideLogoUrl(org: any): string | null {
  return org?.logo_image && org?.org_uuid
    ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)
    : null
}

/** True when the org has any logo to show in a square box. */
export function hasOrgLogo(org: any): boolean {
  return Boolean(org?.logo_image || getOrgSquareLogoFile(org))
}

interface OrgSquareLogoProps {
  org: any
  /** Rendered when the org has neither a square nor a wide logo. */
  fallback: React.ReactNode
  /** Extra classes on the <img>. Sizing comes from the parent box. */
  className?: string
  /** Inset applied when the wide logo has to sit inside a square box. */
  wideInsetClassName?: string
  alt?: string
  /** Load the image in CORS mode so it can be drawn onto a canvas (PDF export). */
  crossOrigin?: 'anonymous'
}

// The media host only sends CORS headers when the request carries an Origin,
// and the browser cache does not split entries by request mode. A logo first
// loaded by a plain <img> elsewhere on the page would then be reused for the
// CORS load and rejected, so CORS loads get their own cache entry.
function corsSafeUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}cors=1`
}

/**
 * Fills a square box with the best available logo: the square logo edge to
 * edge, otherwise the wide logo letterboxed inside the box, otherwise the
 * caller's fallback. Every place that shows the brand in a square (sign-in
 * panel, org switcher, dashboard sidebar) goes through this so the fallback
 * chain is decided once.
 */
export default function OrgSquareLogo({
  org,
  fallback,
  className,
  wideInsetClassName = 'p-[12%]',
  alt,
  crossOrigin,
}: OrgSquareLogoProps) {
  // A media host without CORS rejects the load outright; fall back to a plain
  // image so the logo still shows on screen, even if the PDF can't include it.
  const [corsFailed, setCorsFailed] = React.useState(false)
  const cors = crossOrigin && !corsFailed ? crossOrigin : undefined
  const onError = cors ? () => setCorsFailed(true) : undefined
  const toSrc = (url: string) => (cors ? corsSafeUrl(url) : url)
  const square = getOrgSquareLogoUrl(org)
  const wide = getOrgWideLogoUrl(org)
  const label = alt ?? org?.name ?? ''

  if (square) {
    return (
      <img
        src={toSrc(square)}
        alt={label}
        crossOrigin={cors}
        onError={onError}
        className={cn('w-full h-full object-cover', className)}
      />
    )
  }
  if (wide) {
    return (
      <img
        src={toSrc(wide)}
        alt={label}
        crossOrigin={cors}
        onError={onError}
        className={cn('w-full h-full object-contain', wideInsetClassName, className)}
      />
    )
  }
  return <>{fallback}</>
}
