import { VideoCamera } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.live_sessions',
  titleKey: 'live_sessions.title',
  descriptionKey: 'dashboard.search.entries.live_sessions.description',
  keywordsKey: 'dashboard.search.entries.live_sessions.keywords',
  icon: VideoCamera,
  href: '/dash/live-sessions',
  group: 'navigation',
  featureKey: 'live_sessions',
}
