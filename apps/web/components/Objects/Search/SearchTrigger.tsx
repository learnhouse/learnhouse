'use client'
import React from 'react'
import { Search } from 'lucide-react'
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
 * The search field in the org header. It looks like the input it replaced
 * but opens the command palette, so every entry point shares one search
 * surface and one set of keyboard rules.
 */
export function SearchTrigger({ className = '', primaryColor = '', isMobile = false }: Props) {
  const { t } = useTranslation()
  const { setOpen } = useSiteCommandPalette()
  const isMac = useIsMac()
  const colors = getMenuColorClasses(primaryColor)

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('search.palette.trigger')}
      aria-haspopup="dialog"
      className={`group relative flex h-9 w-full items-center rounded-xl ps-11 pe-3 text-start text-sm
                  transition-all focus:outline-none focus:ring-1 ${colors.searchBg} ${className}`}
    >
      <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5">
        <Search size={18} className={`${colors.searchIcon} transition-colors`} />
      </span>
      <span className="flex-1 truncate opacity-60">{t('search.palette.placeholder')}</span>
      {!isMobile && (
        <kbd
          className="ms-2 hidden shrink-0 items-center rounded-md border border-current/10 px-1.5 py-0.5
                     font-sans text-[10.5px] font-medium leading-none tracking-wide opacity-50 sm:inline-flex"
        >
          {isMac ? t('search.palette.hint_mac') : t('search.palette.hint_other')}
        </kbd>
      )}
    </button>
  )
}
