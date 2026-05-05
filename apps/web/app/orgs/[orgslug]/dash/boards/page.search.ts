import { ChalkboardSimple } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.boards',
  titleKey: 'common.boards',
  descriptionKey: 'dashboard.search.entries.boards.description',
  keywordsKey: 'dashboard.search.entries.boards.keywords',
  icon: ChalkboardSimple,
  href: '/dash/boards',
  group: 'navigation',
  featureKey: 'boards',
  featureDefaultDisabled: true,
}
