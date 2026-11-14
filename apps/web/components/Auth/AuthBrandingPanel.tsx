'use client'
import React from 'react'
import { useTranslation, Trans } from 'react-i18next'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import { AuthDots } from '@components/Auth/AuthUI'
import { AuthLogoTile, readAuthBranding, UNSPLASH_UTM } from '@components/Auth/AuthBrandMark'

interface AuthBrandingPanelProps {
  org: any
  welcomeText?: string
  // No-org (apex) panel copy: platform-style title + subtitle shown at the top
  // of the illustration. Falls back to the login wording when omitted.
  title?: string
  subtitle?: string
}

/**
 * The desktop sign-in panel beside the form. By default it is the dashboard
 * sidebar's near-black surface with its fine dot grid; an org that picked a
 * photo (Settings → Branding → Sign-in page) gets it full-bleed under a scrim.
 * The org-less apex shows the platform illustration.
 */
export default function AuthBrandingPanel({ org, welcomeText, title, subtitle }: AuthBrandingPanelProps) {
  const { t } = useTranslation()
  const isWhiteLabel = isWhiteLabelPlan(usePlan())
  const { welcomeMessage, imageUrl, textColor, unsplash } = readAuthBranding(org)
  const noOrg = !org
  const hasPhoto = !noOrg && !!imageUrl
  // Text colour is an option for photos only; the default panel is dark.
  const light = !hasPhoto || textColor === 'light'
  const displayMessage = welcomeMessage || welcomeText || ''

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0f0f10] isolate">
      {noOrg ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-cover bg-center"
            style={{ backgroundImage: 'url(/auth-default.webp)' }}
          />
          {/* Darken the top so the heading reads over the illustration. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[40%] -z-10 bg-black/40 backdrop-blur-sm"
            style={{
              maskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
            }}
          />
        </>
      ) : hasPhoto ? (
        <>
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
          <div aria-hidden="true" className={cn('absolute inset-0 -z-10', light ? 'bg-black/35' : 'bg-white/30')} />
        </>
      ) : (
        <>
          <AuthDots tone="light" from="bottom" className="h-[70%] -z-10" />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(120% 70% at 50% 115%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.025) 45%, transparent 75%)',
            }}
          />
        </>
      )}

      <div className="relative flex h-full flex-col p-8 xl:p-10">
        {noOrg ? (
          <div className="max-w-md text-white">
            <h2 className="text-[28px] font-semibold leading-tight tracking-tight">{title || t('auth.image_title_login')}</h2>
            <p className="mt-3 text-base leading-relaxed text-white/60">{subtitle || t('auth.image_subtitle_login')}</p>
          </div>
        ) : (
          <>
            {/* LearnHouse mark, never on white-label plans. */}
            {!isWhiteLabel && (
              <Link
                href="https://learnhouse.app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LearnHouse"
                className="w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <img
                  src="/lrn.svg"
                  alt=""
                  width={22}
                  height={22}
                  className={cn('transition-opacity', light ? 'invert opacity-50 hover:opacity-80' : 'opacity-40 hover:opacity-70')}
                />
              </Link>
            )}

            <div className="flex flex-1 items-center justify-center">
              <div className={cn('flex max-w-sm flex-col items-center text-center', light ? 'text-white' : 'text-neutral-900')}>
                <Link
                  href={getUriWithOrg(org?.slug, '/')}
                  className="rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
                >
                  <AuthLogoTile
                    org={org}
                    className="h-[72px] w-[72px] rounded-[20px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
                    initialClassName="text-3xl"
                  />
                </Link>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight break-words">{org?.name || 'LearnHouse'}</h2>
                {displayMessage && (
                  <p className={cn('mt-1.5 text-[15px] leading-relaxed', light ? 'text-white/55' : 'text-neutral-600')}>
                    {displayMessage}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Unsplash attribution (required by Unsplash API guidelines) */}
        {hasPhoto && unsplash && (
          <p className={cn('mt-auto pt-4 text-[11px] leading-tight', light ? 'text-white/70' : 'text-neutral-700')}>
            <Trans
              i18nKey="auth.photo_credit"
              values={{ name: unsplash.name }}
              components={{
                photographer: (
                  <a href={unsplash.url ? `${unsplash.url}${UNSPLASH_UTM}` : ''} target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100" />
                ),
                unsplash: (
                  <a href={`https://unsplash.com/${UNSPLASH_UTM}`} target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100" />
                ),
              }}
            />
          </p>
        )}
      </div>
    </div>
  )
}
