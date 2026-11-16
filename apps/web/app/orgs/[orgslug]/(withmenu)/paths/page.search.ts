import { Circuitry } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.paths',
  titleKey: 'paths.title',
  descriptionKey: 'search.palette.entries.paths.description',
  keywordsKey: 'search.palette.entries.paths.keywords',
  icon: Circuitry,
  href: '/paths',
  shortcut: 'g r',
  featureKey: 'paths',
  menuType: 'paths',
}
