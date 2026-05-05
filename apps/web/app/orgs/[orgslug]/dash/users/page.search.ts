import { Users, UsersThree, ShieldCheck, UserPlus } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMetas: SearchMeta[] = [
  {
    id: 'dash.users.list',
    titleKey: 'dashboard.users.settings.tabs.users',
    descriptionKey: 'dashboard.search.entries.users.description',
    keywordsKey: 'dashboard.search.entries.users.keywords',
    icon: Users,
    href: '/dash/users/settings/users',
    group: 'users',
  },
  {
    id: 'dash.users.usergroups',
    titleKey: 'dashboard.users.settings.tabs.usergroups',
    descriptionKey: 'dashboard.search.entries.usergroups.description',
    keywordsKey: 'dashboard.search.entries.usergroups.keywords',
    icon: UsersThree,
    href: '/dash/users/settings/usergroups',
    group: 'users',
  },
  {
    id: 'dash.users.roles',
    titleKey: 'dashboard.users.settings.tabs.roles',
    descriptionKey: 'dashboard.search.entries.roles.description',
    keywordsKey: 'dashboard.search.entries.roles.keywords',
    icon: ShieldCheck,
    href: '/dash/users/settings/roles',
    group: 'users',
  },
  {
    id: 'dash.users.signups',
    titleKey: 'dashboard.users.settings.tabs.signups',
    descriptionKey: 'dashboard.search.entries.signups.description',
    keywordsKey: 'dashboard.search.entries.signups.keywords',
    icon: UserPlus,
    href: '/dash/users/settings/signups',
    group: 'users',
  },
]
