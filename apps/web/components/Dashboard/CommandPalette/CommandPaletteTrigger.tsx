'use client'
import React, { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useCommandPalette } from './CommandPaletteContext'

interface Props {
  isCollapsed?: boolean
}

export default function CommandPaletteTrigger({ isCollapsed = false }: Props) {
  const { t } = useTranslation()
  const { setOpen } = useCommandPalette()
  const [shortcut, setShortcut] = useState<string>('⌘K')

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !/Mac|iPhone|iPad/.test(navigator.platform)) {
      setShortcut('Ctrl K')
    }
  }, [])

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('dashboard.search.trigger')}
        className="flex h-10 w-full items-center justify-center rounded-lg text-white/50 transition-all hover:bg-white/[0.08] hover:text-white"
      >
        <MagnifyingGlass size={18} weight="fill" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('dashboard.search.trigger')}
      className="flex w-full items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-left text-white/60 transition-all hover:bg-white/[0.08] hover:text-white"
    >
      <MagnifyingGlass size={16} />
      <span className="flex-1 text-sm font-medium">{t('dashboard.search.trigger')}</span>
      <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-white/10 bg-white/[0.04] px-1.5 text-[10px] font-medium text-white/50">
        {shortcut}
      </kbd>
    </button>
  )
}
