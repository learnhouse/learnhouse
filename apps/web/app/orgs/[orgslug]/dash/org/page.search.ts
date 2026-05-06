import { Buildings, Sliders, ChartBar } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMetas: SearchMeta[] = [
  {
    id: 'dash.org.general',
    titleKey: 'dashboard.organization.settings.tabs.general',
    descriptionKey: 'dashboard.search.entries.org_general.description',
    keywordsKey: 'dashboard.search.entries.org_general.keywords',
    icon: Buildings,
    href: '/dash/org/settings/general',
    group: 'settings',
  },
  {
    id: 'dash.org.features',
    titleKey: 'dashboard.organization.settings.tabs.features',
    descriptionKey: 'dashboard.search.entries.org_features.description',
    keywordsKey: 'dashboard.search.entries.org_features.keywords',
    icon: Sliders,
    href: '/dash/org/settings/features',
    group: 'settings',
  },
  {
    id: 'dash.org.usage',
    titleKey: 'dashboard.organization.settings.tabs.usage',
    descriptionKey: 'dashboard.search.entries.org_billing.description',
    keywordsKey: 'dashboard.search.entries.org_billing.keywords',
    icon: ChartBar,
    href: '/dash/org/settings/usage',
    group: 'settings',
  },
]
