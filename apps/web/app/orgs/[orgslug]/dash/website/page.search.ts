import { Globe } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMetas: SearchMeta[] = [
  {
    id: 'dash.website',
    titleKey: 'website.title',
    descriptionKey: 'website.search.description',
    keywordsKey: 'website.search.keywords',
    icon: Globe,
    href: '/dash/website',
    group: 'navigation',
    requiresOrgAdmin: true,
  },
  {
    id: 'dash.website.builder',
    titleKey: 'website.search.builder_title',
    descriptionKey: 'website.search.builder_description',
    keywordsKey: 'website.search.builder_keywords',
    icon: Globe,
    href: '/dash/org/landing-builder',
    group: 'navigation',
    requiresOrgAdmin: true,
  },
]
