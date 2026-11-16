'use client'
import React from 'react'
import { Trans } from 'react-i18next'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'
import { ThemeIconButton } from '@components/Objects/Theme/ThemeSwitch'
import { AuthLogoTile, readAuthBranding, UNSPLASH_UTM } from '@components/Auth/AuthBrandMark'

interface AuthMobileHeaderProps {
  org: any
}

/**
 * The top of the auth pages below lg (and the brand row above the form on
 * desktop's org-less apex): org logo and name at the start, the language
 * switcher at the end. An org with a sign-in photo gets it as a slim banner
 * behind the row so the branding still shows on phones.
 */
export default function AuthMobileHeader({ org }: AuthMobileHeaderProps) {
  const { welcomeMessage, imageUrl, textColor, unsplash } = readAuthBranding(org)
  const hasPhoto = !!org && !!imageUrl
  const light = hasPhoto && textColor === 'light'

  const brand = org ? (
    <Link
      href={getUriWithOrg(org?.slug, '/')}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-xl p-1 -m-1 focus-visible:outline-none focus-visible:ring-2',
        light ? 'focus-visible:ring-white/50' : 'focus-visible:ring-neutral-900/20'
      )}
    >
      <AuthLogoTile org={org} className="h-9 w-9 rounded-[10px]" initialClassName="text-sm" />
      <span className="min-w-0">
        <span className={cn('block truncate text-sm font-semibold tracking-tight', light ? 'text-white' : 'text-neutral-900')}>
          {org?.name}
        </span>
        {welcomeMessage && (
          <span className={cn('block truncate text-xs', light ? 'text-white/70' : 'text-neutral-500')}>{welcomeMessage}</span>
        )}
      </span>
    </Link>
  ) : (
    <span className="flex items-center gap-2.5">
      <img src="/lrn.svg" alt="LearnHouse" width={28} height={28} className="h-7 w-7" />
    </span>
  )

  if (!hasPhoto) {
    return (
      <div className="flex items-center justify-between gap-3 min-w-0">
        {brand}
        <div className="shrink-0 flex items-center gap-1">
          <ThemeIconButton className="h-9 w-9 text-gray-600 hover:bg-gray-100" />
          <LanguageSwitcher />
        </div>
      </div>
    )
  }

  return (
    <div className="relative isolate overflow-hidden rounded-2xl px-4 pb-4 pt-14 nice-shadow">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
      <div
        aria-hidden="true"
        className={cn('absolute inset-0 -z-10', light ? 'bg-gradient-to-t from-black/60 via-black/25 to-black/10' : 'bg-white/40')}
      />
      <div className="absolute top-2 end-2 flex items-center gap-1">
        <ThemeIconButton className={cn('h-9 w-9', light ? 'text-white hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100')} />
        <LanguageSwitcher primaryColor={light ? '#000000' : ''} />
      </div>
      {brand}
      {unsplash && (
        <span className={cn('absolute top-3.5 start-4 max-w-[55%] truncate text-[10px] leading-tight', light ? 'text-white/70' : 'text-neutral-700')}>
          <Trans
            i18nKey="auth.photo_credit"
            values={{ name: unsplash.name }}
            components={{
              photographer: <a href={unsplash.url ? `${unsplash.url}${UNSPLASH_UTM}` : ''} target="_blank" rel="noopener noreferrer" className="underline" />,
              unsplash: <a href={`https://unsplash.com/${UNSPLASH_UTM}`} target="_blank" rel="noopener noreferrer" className="underline" />,
            }}
          />
        </span>
      )}
    </div>
  )
}
