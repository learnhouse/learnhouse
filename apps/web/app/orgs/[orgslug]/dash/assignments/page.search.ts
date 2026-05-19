import { Files } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.assignments',
  titleKey: 'common.all_assignments',
  descriptionKey: 'dashboard.search.entries.assignments.description',
  keywordsKey: 'dashboard.search.entries.assignments.keywords',
  icon: Files,
  href: '/dash/assignments',
  group: 'navigation',
}
