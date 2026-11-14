import { Newspaper } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.newsletter',
  titleKey: 'newsletter.common.title',
  descriptionKey: 'newsletter.common.search_description',
  keywordsKey: 'newsletter.common.search_keywords',
  icon: Newspaper,
  href: '/dash/newsletter/overview',
  group: 'navigation',
  featureKey: 'newsletter',
}
