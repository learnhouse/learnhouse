'use client'
import React from 'react'
import { Trans } from 'react-i18next'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'
import { getUriWithOrg } from '@services/config/config'
import { usePlan } from '@components/Hooks/usePlan'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'

interface AuthMobileHeaderProps {
  org: any
  welcomeText?: string
}

// Phones get the desktop branding card in compact form: same background,
// logo, name and welcome line, with the language switcher inside it.
export default function AuthMobileHeader({ org, welcomeText }: AuthMobileHeaderProps) {
  const isWhiteLabel = isWhiteLabelPlan(usePlan())
  const authBranding = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding || {}
  const {
    background_type = 'gradient',
    background_image = '',
    unsplash_photographer_name = '',
    unsplash_photographer_url = '',
    unsplash_photo_url = '',
    welcome_message = '',
  } = authBranding
  const displayMessage = welcome_message || welcomeText || ''
  const UNSPLASH_UTM = '?utm_source=LearnHouse&utm_medium=referral'
  const withUtm = (url: string) => (url ? `${url}${UNSPLASH_UTM}` : '')

  const getBackgroundStyle = (): React.CSSProperties => {
    if (background_type === 'gradient' || !background_image) {
      return {
        background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
      }
    }
    if (background_type === 'custom' && background_image) {
      return {
        backgroundImage: `url(${getOrgAuthBackgroundMediaDirectory(org?.org_uuid, background_image)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (background_type === 'unsplash' && background_image) {
      return {
        backgroundImage: `url(${background_image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    return {
      background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
    }
  }

  const hasCustomBackground = background_type !== 'gradient' && background_image

  return (
    <div className="px-3 pt-[calc(0.75rem+var(--lh-safe-top))]">
      <div
        className="relative flex min-h-[176px] flex-col justify-end overflow-hidden rounded-3xl px-5 pb-5 pt-16"
        style={getBackgroundStyle()}
      >
        {hasCustomBackground ? (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/25 to-black/10" />
        ) : (
          // The desktop card's blueprint grid, at phone scale.
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: `linear-gradient(rgba(120,165,255,0.6) 1px, transparent 1px),
                linear-gradient(90deg, rgba(120,165,255,0.6) 1px, transparent 1px)`,
              backgroundSize: '48px 48px, 48px 48px',
            }}
          />
        )}

        <div className="absolute top-2.5 end-2.5 z-10">
          <LanguageSwitcher primaryColor="#000000" />
        </div>

        <Link prefetch href={getUriWithOrg(org?.slug, '/')} className="relative z-10 w-fit">
          <div className="w-14 h-14 rounded-2xl ring-1 ring-inset ring-white/10 bg-white flex items-center justify-center overflow-hidden shrink-0">
            <OrgSquareLogo
              org={org}
              wideInsetClassName="p-2"
              fallback={
                isWhiteLabel ? (
                  <span className="text-2xl font-black text-gray-800">
                    {(org?.name || '?').charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <Image
                    quality={100}
                    width={56}
                    height={56}
                    src={learnhouseIcon}
                    alt="LearnHouse"
                    className="object-contain"
                  />
                )
              }
            />
          </div>
        </Link>

        <div className="relative z-10 mt-4 min-w-0">
          <p className="truncate text-xl font-black tracking-tight text-white">{org?.name || 'LearnHouse'}</p>
          {displayMessage && (
            <p className="mt-0.5 line-clamp-2 text-sm font-medium text-white/65">{displayMessage}</p>
          )}
        </div>

        {/* Unsplash attribution (required by Unsplash API guidelines) */}
        {background_type === 'unsplash' && background_image && unsplash_photographer_name && (
          <span className="absolute bottom-2 end-3 z-10 max-w-[55%] truncate text-end text-[10px] leading-tight text-white/70">
            <Trans
              i18nKey="auth.photo_credit"
              values={{ name: unsplash_photographer_name }}
              components={{
                photographer: (
                  <a
                    href={withUtm(unsplash_photographer_url) || withUtm(unsplash_photo_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  />
                ),
                unsplash: (
                  <a
                    href={`https://unsplash.com/${UNSPLASH_UTM}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  />
                ),
              }}
            />
          </span>
        )}
      </div>
    </div>
  )
}
