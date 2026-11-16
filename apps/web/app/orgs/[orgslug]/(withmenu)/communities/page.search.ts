import { Garage } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.communities',
  titleKey: 'communities.title',
  descriptionKey: 'search.palette.entries.communities.description',
  keywordsKey: 'search.palette.entries.communities.keywords',
  icon: Garage,
  href: '/communities',
  shortcut: 'g m',
  featureKey: 'communities',
  menuType: 'communities',
}
