import { House } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.home',
  titleKey: 'common.home',
  descriptionKey: 'search.palette.entries.home.description',
  keywordsKey: 'search.palette.entries.home.keywords',
  icon: House,
  href: '/',
  shortcut: 'g h',
}
