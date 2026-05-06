import { ChatsCircle } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.communities',
  titleKey: 'communities.title',
  descriptionKey: 'dashboard.search.entries.communities.description',
  keywordsKey: 'dashboard.search.entries.communities.keywords',
  icon: ChatsCircle,
  href: '/dash/communities',
  group: 'navigation',
  featureKey: 'communities',
}
