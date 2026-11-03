import { Steps } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.paths',
  titleKey: 'paths.title',
  descriptionKey: 'dashboard.search.entries.paths.description',
  keywordsKey: 'dashboard.search.entries.paths.keywords',
  icon: Steps,
  href: '/dash/paths',
  group: 'navigation',
  featureKey: 'paths',
}
