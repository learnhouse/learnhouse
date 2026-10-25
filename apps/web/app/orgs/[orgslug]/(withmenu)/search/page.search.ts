import { MagnifyingGlass } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.search',
  titleKey: 'common.search',
  descriptionKey: 'search.palette.entries.search.description',
  keywordsKey: 'search.palette.entries.search.keywords',
  icon: MagnifyingGlass,
  href: '/search',
}
