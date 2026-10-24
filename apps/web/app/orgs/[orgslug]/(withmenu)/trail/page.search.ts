import { Signpost } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.trail',
  titleKey: 'courses.progress',
  descriptionKey: 'search.palette.entries.trail.description',
  keywordsKey: 'search.palette.entries.trail.keywords',
  icon: Signpost,
  href: '/trail',
  shortcut: 'g t',
  requiresAuth: true,
}
