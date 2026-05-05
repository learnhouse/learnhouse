import { CurrencyCircleDollar, Tag } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMetas: SearchMeta[] = [
  {
    id: 'dash.payments.overview',
    titleKey: 'common.payments',
    descriptionKey: 'dashboard.search.entries.payments_overview.description',
    keywordsKey: 'dashboard.search.entries.payments_overview.keywords',
    icon: CurrencyCircleDollar,
    href: '/dash/payments/overview',
    group: 'payments',
    featureKey: 'payments',
  },
  {
    id: 'dash.payments.offers',
    titleKey: 'common.payments',
    descriptionKey: 'dashboard.search.entries.payments_products.description',
    keywordsKey: 'dashboard.search.entries.payments_products.keywords',
    icon: Tag,
    href: '/dash/payments/offers',
    group: 'payments',
    featureKey: 'payments',
  },
]
