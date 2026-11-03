import { CalendarDots } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.calendar',
  titleKey: 'calendar.title',
  descriptionKey: 'calendar.search.description',
  keywordsKey: 'calendar.search.keywords',
  icon: CalendarDots,
  href: '/calendar',
  shortcut: 'g e',
  requiresAuth: true,
}
