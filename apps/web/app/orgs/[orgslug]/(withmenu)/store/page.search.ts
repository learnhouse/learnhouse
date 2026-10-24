import { ShoppingBag } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.store',
  titleKey: 'common.store',
  descriptionKey: 'search.palette.entries.store.description',
  keywordsKey: 'search.palette.entries.store.keywords',
  icon: ShoppingBag,
  href: '/store',
  shortcut: 'g s',
  featureKey: 'payments',
  menuType: 'store',
}
