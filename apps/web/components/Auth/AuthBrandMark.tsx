'use client'
import React from 'react'
import OrgSquareLogo, { OrgInitial } from '@components/Objects/Org/OrgSquareLogo'
import { usePlan } from '@components/Hooks/usePlan'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import { getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'

/**
 * The org's logo in a white square tile. Without a logo, white-label plans
 * show the org's initial and everyone else the LearnHouse mark, the same
 * fallback chain as the dashboard sidebar.
 */
export function AuthLogoTile({ org, className = '', initialClassName = '' }: { org: any; className?: string; initialClassName?: string }) {
  const isWhiteLabel = isWhiteLabelPlan(usePlan())
  return (
    <div className={cn('shrink-0 overflow-hidden bg-white flex items-center justify-center ring-1 ring-inset ring-black/[0.06]', className)}>
      <OrgSquareLogo
        org={org}
        wideInsetClassName="p-[14%]"
        fallback={
          isWhiteLabel ? (
            <OrgInitial org={org} className={initialClassName} />
          ) : (
            <img src="/lrn.svg" alt="LearnHouse" className="w-full h-full object-contain p-[22%]" />
          )
        }
      />
    </div>
  )
}

/** The org's sign-in page branding (Settings → Branding → Sign-in page). */
export function readAuthBranding(org: any) {
  const raw = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding || {}
  const {
    welcome_message = '',
    background_type = 'gradient',
    background_image = '',
    text_color = 'light',
    unsplash_photographer_name = '',
    unsplash_photographer_url = '',
    unsplash_photo_url = '',
  } = raw
  let imageUrl = ''
  if (background_image && background_type === 'custom') {
    imageUrl = getOrgAuthBackgroundMediaDirectory(org?.org_uuid, background_image)
  } else if (background_image && background_type === 'unsplash') {
    imageUrl = background_image
  }
  return {
    welcomeMessage: welcome_message as string,
    imageUrl,
    textColor: (text_color === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    unsplash:
      background_type === 'unsplash' && background_image && unsplash_photographer_name
        ? {
            name: unsplash_photographer_name as string,
            url: (unsplash_photographer_url || unsplash_photo_url) as string,
          }
        : null,
  }
}

export const UNSPLASH_UTM = '?utm_source=LearnHouse&utm_medium=referral'
