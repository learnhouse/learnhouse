import { VideoCamera } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.live_sessions',
  titleKey: 'live_sessions.title',
  descriptionKey: 'search.palette.entries.live_sessions.description',
  keywordsKey: 'search.palette.entries.live_sessions.keywords',
  icon: VideoCamera,
  href: '/live',
  shortcut: 'g v',
  featureKey: 'live_sessions',
  menuType: 'live',
}
