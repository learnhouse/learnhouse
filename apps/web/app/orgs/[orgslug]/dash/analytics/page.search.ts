import { ChartLine } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.analytics',
  titleKey: 'common.analytics',
  descriptionKey: 'dashboard.search.entries.analytics.description',
  keywordsKey: 'dashboard.search.entries.analytics.keywords',
  icon: ChartLine,
  href: '/dash/analytics',
  group: 'analytics',
}
