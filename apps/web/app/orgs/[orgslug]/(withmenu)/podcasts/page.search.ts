import { Headphones } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.podcasts',
  titleKey: 'podcasts.podcasts',
  descriptionKey: 'search.palette.entries.podcasts.description',
  keywordsKey: 'search.palette.entries.podcasts.keywords',
  icon: Headphones,
  href: '/podcasts',
  shortcut: 'g p',
  featureKey: 'podcasts',
  menuType: 'podcasts',
}
