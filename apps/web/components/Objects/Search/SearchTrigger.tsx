'use client'
import React from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'
import { useIsMac } from '@/hooks/useIsMac'
import { useSiteCommandPalette } from './SiteCommandPaletteContext'

interface Props {
  className?: string
  primaryColor?: string
  isMobile?: boolean
}

/**
 * The search pill in the org header. It opens the command palette, so every
 * entry point shares one search surface and one set of keyboard rules.
 *
 * The header gives it whatever room is left beside the menu links, so it
 * sizes itself from its own width (a container query) rather than the
 * viewport: a round icon button when squeezed, "Search" with no hint when
 * narrow, and the full field with the ⌘K hint when there is room. It never
 * shrinks below the icon, so it can't disappear or clip its label.
 */
export function SearchTrigger({ className = '', primaryColor = '', isMobile = false }: Props) {
  const { t } = useTranslation()
  const { setOpen } = useSiteCommandPalette()
  const isMac = useIsMac()
  const colors = getMenuColorClasses(primaryColor)

  return (
    <div className={`@container flex min-w-9 justify-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('search.palette.trigger')}
        aria-haspopup="dialog"
        title={`${t('search.palette.trigger')} (${isMac ? t('search.palette.hint_mac') : t('search.palette.hint_other')})`}
        className={`group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-xl ps-3 pe-1.5 text-start text-sm transition-[background-color,box-shadow,color]
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20
                    @max-[9.5rem]:w-9 @max-[9.5rem]:justify-center @max-[9.5rem]:rounded-full @max-[9.5rem]:px-0
                    ${colors.searchBg}`}
      >
        <MagnifyingGlass size={17} weight="bold" className={`shrink-0 ${colors.searchIcon} transition-colors`} />
        <span className="min-w-0 flex-1 truncate opacity-60 @max-[9.5rem]:hidden">
          <span className="@max-[17rem]:hidden">{t('search.palette.placeholder')}</span>
          <span className="hidden @max-[17rem]:inline">{t('search.palette.trigger')}</span>
        </span>
        {!isMobile && (
          <kbd
            className="inline-flex h-6 shrink-0 items-center rounded-lg border border-current/10 bg-current/[0.04] px-1.5
                       font-sans text-[11px] font-medium leading-none tracking-wide opacity-55 @max-[13rem]:hidden"
          >
            {isMac ? t('search.palette.hint_mac') : t('search.palette.hint_other')}
          </kbd>
        )}
      </button>
    </div>
  )
}
