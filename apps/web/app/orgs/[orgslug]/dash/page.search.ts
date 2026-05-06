import { House } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.home',
  titleKey: 'common.home',
  descriptionKey: 'dashboard.search.entries.home.description',
  keywordsKey: 'dashboard.search.entries.home.keywords',
  icon: House,
  href: '/dash',
  group: 'home',
}
