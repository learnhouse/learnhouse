'use client'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { clearActive, moveActive, openActive } from '@/lib/shortcuts/listNavigation'

/**
 * Drop into any page that renders cards marked `data-kbd-item`: `j`/`k`
 * (or ↓/↑) step through them, Enter opens the current one. Pass page
 * callbacks to also bind `]`/`[` to the catalog pagination.
 */
export default function ListShortcuts({
  onNextPage,
  onPrevPage,
  hasNextPage = false,
  hasPrevPage = false,
}: {
  onNextPage?: () => void
  onPrevPage?: () => void
  hasNextPage?: boolean
  hasPrevPage?: boolean
}) {
  const { t } = useTranslation()

  useShortcut({
    id: 'list.next', keys: 'j', aliases: ['arrowdown'], group: 'page', hideFromPalette: true,
    label: t('shortcuts.next_item'),
    run: () => { moveActive(1) },
  })
  useShortcut({
    id: 'list.prev', keys: 'k', aliases: ['arrowup'], group: 'page', hideFromPalette: true,
    label: t('shortcuts.previous_item'),
    run: () => { moveActive(-1) },
  })
  useShortcut({
    id: 'list.open', keys: 'enter', group: 'page', hideFromPalette: true,
    label: t('shortcuts.open_item'),
    run: () => { openActive() },
  })
  useShortcut(
    { id: 'list.nextPage', keys: ']', group: 'page', label: t('shortcuts.next_page'),
      run: () => { clearActive(); onNextPage?.() } },
    !!onNextPage && hasNextPage,
  )
  useShortcut(
    { id: 'list.prevPage', keys: '[', group: 'page', label: t('shortcuts.previous_page'),
      run: () => { clearActive(); onPrevPage?.() } },
    !!onPrevPage && hasPrevPage,
  )

  // A click or tap elsewhere ends keyboard browsing; leave no stale ring behind.
  useEffect(() => {
    const onPointer = () => clearActive()
    document.addEventListener('pointerdown', onPointer, true)
    return () => document.removeEventListener('pointerdown', onPointer, true)
  }, [])

  return null
}
