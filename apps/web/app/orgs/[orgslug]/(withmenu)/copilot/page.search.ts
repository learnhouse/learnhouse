import { ChatCircle } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.copilot',
  titleKey: 'search.palette.entries.copilot.title',
  descriptionKey: 'search.palette.entries.copilot.description',
  keywordsKey: 'search.palette.entries.copilot.keywords',
  icon: ChatCircle,
  href: '/copilot',
  shortcut: 'g a',
  featureKey: 'ai',
  requiresAuth: true,
  requiresCopilot: true,
}
