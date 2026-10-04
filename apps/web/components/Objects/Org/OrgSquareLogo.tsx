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
}: OrgSquareLogoProps) {
  const square = getOrgSquareLogoUrl(org)
  const wide = getOrgWideLogoUrl(org)
  const label = alt ?? org?.name ?? ''

  if (square) {
    return <img src={square} alt={label} className={cn('w-full h-full object-cover', className)} />
  }
  if (wide) {
    return (
      <img
        src={wide}
        alt={label}
        className={cn('w-full h-full object-contain', wideInsetClassName, className)}
      />
    )
  }
  return <>{fallback}</>
}
