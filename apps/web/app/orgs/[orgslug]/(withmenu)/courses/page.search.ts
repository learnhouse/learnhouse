import { Books } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.courses',
  titleKey: 'courses.courses',
  descriptionKey: 'search.palette.entries.courses.description',
  keywordsKey: 'search.palette.entries.courses.keywords',
  icon: Books,
  href: '/courses',
  shortcut: 'g c',
  featureKey: 'courses',
  menuType: 'courses',
}
