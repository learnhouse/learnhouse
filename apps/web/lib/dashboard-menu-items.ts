import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  ChatsCircle,
} from '@phosphor-icons/react'

export interface DashboardMenuItem {
  id: string
  href: string
  icon: typeof House
  labelKey: string
}

export const DASHBOARD_MENU_ITEMS: DashboardMenuItem[] = [
  {
    id: 'home',
    href: '/dash',
    icon: House,
    labelKey: 'common.home',
  },
  {
    id: 'courses',
    href: '/dash/courses',
    icon: BookOpen,
    labelKey: 'courses.courses',
  },
  {
    id: 'assignments',
    href: '/dash/assignments',
    icon: Files,
    labelKey: 'common.assignments',
  },
  {
    id: 'communities',
    href: '/dash/communities',
    icon: ChatsCircle,
    labelKey: 'communities.title',
  },
  {
    id: 'users',
    href: '/dash/users/settings/users',
    icon: Users,
    labelKey: 'common.users',
  },
  {
    id: 'payments',
    href: '/dash/payments/customers',
    icon: CurrencyCircleDollar,
    labelKey: 'common.payments',
  },
  {
    id: 'organization',
    href: '/dash/org/settings/general',
    icon: Buildings,
    labelKey: 'common.organization',
  },
]
