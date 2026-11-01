import { Cube } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.playgrounds',
  titleKey: 'common.playgrounds',
  descriptionKey: 'search.palette.entries.playgrounds.description',
  keywordsKey: 'search.palette.entries.playgrounds.keywords',
  icon: Cube,
  href: '/playgrounds',
  shortcut: 'g y',
  featureKey: 'playgrounds',
  menuType: 'playgrounds',
}
