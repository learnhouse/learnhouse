import { ChalkboardSimple } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.boards',
  titleKey: 'common.boards',
  descriptionKey: 'search.palette.entries.boards.description',
  keywordsKey: 'search.palette.entries.boards.keywords',
  icon: ChalkboardSimple,
  href: '/boards',
  shortcut: 'g b',
  featureKey: 'boards',
  requiresAuth: true,
}
