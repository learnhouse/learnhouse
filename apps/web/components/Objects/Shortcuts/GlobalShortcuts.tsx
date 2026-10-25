'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useSitePages } from '@/lib/site-search/useSitePages'
import { useShortcut, useShortcuts } from '@/lib/shortcuts/ShortcutsContext'
import { useSiteCommandPalette } from '@components/Objects/Search/SiteCommandPaletteContext'

/**
 * Registers the shortcuts that exist on every learner page: `?` for the
 * help sheet, `/` for search, and one `g …` chord per navigable page from
 * the site registry (so a page the org hid or the visitor cannot open has
 * no chord either).
 */
export default function GlobalShortcuts() {
  const { t } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const orgslug: string = org?.slug ?? ''
  const pages = useSitePages()
  const { register, setHelpOpen, helpOpen } = useShortcuts()
  const { setOpen: setPaletteOpen } = useSiteCommandPalette()

  useShortcut({
    id: 'global.help',
    keys: '?',
    label: t('shortcuts.open_help'),
    group: 'global',
    allowInDialog: true,
    run: () => setHelpOpen(!helpOpen),
  })

  useShortcut({
    id: 'global.search',
    keys: '/',
    label: t('shortcuts.open_search'),
    group: 'global',
    run: () => setPaletteOpen(true),
  })

  useEffect(() => {
    const unregisters = pages
      .filter((page) => page.shortcut)
      .map((page) =>
        register({
          id: `nav.${page.id}`,
          keys: page.shortcut!,
          label: t('shortcuts.go_to', { page: t(page.titleKey) }),
          group: 'navigation',
          hideFromPalette: true,
          run: () => router.push(getUriWithOrg(orgslug, page.href)),
        }),
      )
    return () => unregisters.forEach((off) => off())
  }, [pages, register, router, orgslug, t])

  return null
}
