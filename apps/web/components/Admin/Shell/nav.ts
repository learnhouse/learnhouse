import {
  Bell,
  Buildings,
  ChartBar,
  ChartLineUp,
  CheckSquareOffset,
  ClockCounterClockwise,
  Code,
  Coins,
  EnvelopeSimple,
  Eye,
  GearSix,
  FlowArrow,
  Handshake,
  HardDrives,
  House,
  Lightning,
  PaperPlaneTilt,
  PresentationChart,
  Trash,
  Users,
  UsersThree,
  UserSwitch,
} from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import type { PlatformPermission } from '@services/ee/platform/types'

export interface AdminNavItem {
  key: string
  href: string
  labelKey: string
  /** One line under the name in the group menu. */
  descKey?: string
  icon: PhosphorIcon
  /** Any one of these grants the item; empty = every team member. */
  perms: PlatformPermission[]
  exact?: boolean
  /** Icon color (the bar is always dark, so -400 shades). */
  hue: string
  /** Page not shipped yet: kept in the config, left out of the bar and ⌘K. */
  soon?: boolean
}

export interface AdminNavGroup {
  key: string
  labelKey: string
  icon: PhosphorIcon
  hue: string
  /** A single page shown as a plain link instead of a menu. */
  direct?: boolean
  items: AdminNavItem[]
}

// Six entries in the bar: two direct links and four menus.
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    key: 'overview',
    labelKey: 'admin.nav.overview',
    icon: House,
    hue: 'text-sky-400',
    direct: true,
    items: [{ key: 'overview', href: '/admin', labelKey: 'admin.nav.overview', icon: House, perms: ['platform.read'], exact: true, hue: 'text-sky-400' }],
  },
  {
    key: 'organizations',
    labelKey: 'admin.nav.group_organizations',
    icon: Buildings,
    hue: 'text-blue-400',
    items: [
      { key: 'organizations', href: '/admin/organizations', labelKey: 'admin.nav.organizations', descKey: 'admin.nav.desc.organizations', icon: Buildings, perms: ['platform.read'], hue: 'text-blue-400' },
      { key: 'pocs', href: '/admin/pocs', labelKey: 'admin.nav.pocs', descKey: 'admin.nav.desc.pocs', icon: Handshake, perms: ['platform.read'], hue: 'text-violet-400' },
      { key: 'demos', href: '/admin/demos', labelKey: 'admin.nav.demos', descKey: 'admin.nav.desc.demos', icon: PresentationChart, perms: ['platform.read'], hue: 'text-sky-400' },
      { key: 'deletions', href: '/admin/deletions', labelKey: 'admin.nav.deletions', descKey: 'admin.nav.desc.deletions', icon: Trash, perms: ['platform.read'], hue: 'text-rose-400' },
    ],
  },
  {
    key: 'users',
    labelKey: 'admin.nav.users',
    icon: Users,
    hue: 'text-emerald-400',
    direct: true,
    items: [{ key: 'users', href: '/admin/users', labelKey: 'admin.nav.users', icon: Users, perms: ['platform.read'], hue: 'text-emerald-400' }],
  },
  {
    key: 'operations',
    labelKey: 'admin.nav.group_operations',
    icon: Lightning,
    hue: 'text-amber-400',
    items: [
      { key: 'automations', href: '/admin/automations', labelKey: 'admin.nav.automations', descKey: 'admin.nav.desc.automations', icon: FlowArrow, perms: ['automations.run', 'automations.manage'], hue: 'text-amber-400' },
      { key: 'tasks', href: '/admin/tasks', labelKey: 'admin.nav.tasks', descKey: 'admin.nav.desc.tasks', icon: CheckSquareOffset, perms: ['platform.read'], hue: 'text-teal-400' },
      { key: 'following', href: '/admin/following', labelKey: 'admin.nav.following', descKey: 'admin.nav.desc.following', icon: Eye, perms: ['platform.read'], hue: 'text-indigo-400' },
      { key: 'emails', href: '/admin/emails', labelKey: 'admin.nav.emails', descKey: 'admin.nav.desc.emails', icon: EnvelopeSimple, perms: ['emails.send'], hue: 'text-sky-400' },
      { key: 'deliverability', href: '/admin/deliverability', labelKey: 'admin.nav.deliverability', descKey: 'admin.nav.desc.deliverability', icon: PaperPlaneTilt, perms: ['platform.read'], hue: 'text-lime-400' },
      { key: 'notifications', href: '/admin/notifications', labelKey: 'admin.nav.notifications', descKey: 'admin.nav.desc.notifications', icon: Bell, perms: ['platform.read'], hue: 'text-rose-400' },
      { key: 'impersonations', href: '/admin/impersonations', labelKey: 'admin.nav.impersonations', descKey: 'admin.nav.desc.impersonations', icon: UserSwitch, perms: ['impersonation.readonly', 'audit.read'], hue: 'text-fuchsia-400' },
    ],
  },
  {
    key: 'insights',
    labelKey: 'admin.nav.group_insights',
    icon: ChartLineUp,
    hue: 'text-cyan-400',
    items: [
      { key: 'activity', href: '/admin/activity', labelKey: 'admin.nav.activity', descKey: 'admin.nav.desc.activity', icon: ClockCounterClockwise, perms: ['audit.read'], hue: 'text-cyan-400' },
      { key: 'analytics', href: '/admin/analytics', labelKey: 'admin.nav.analytics', descKey: 'admin.nav.desc.analytics', icon: ChartBar, perms: ['platform.read'], hue: 'text-pink-400' },
      { key: 'ai_costs', href: '/admin/ai-costs', labelKey: 'admin.nav.ai_costs', descKey: 'admin.nav.desc.ai_costs', icon: Coins, perms: ['platform.read'], hue: 'text-emerald-400' },
    ],
  },
  {
    key: 'settings',
    labelKey: 'admin.nav.group_settings',
    icon: GearSix,
    hue: 'text-zinc-300',
    items: [
      { key: 'team', href: '/admin/team', labelKey: 'admin.nav.team', descKey: 'admin.nav.desc.team', icon: UsersThree, perms: ['platform.read'], hue: 'text-orange-400' },
      { key: 'developers', href: '/admin/developers', labelKey: 'admin.nav.developers', descKey: 'admin.nav.desc.developers', icon: Code, perms: ['tokens.manage'], hue: 'text-lime-400' },
      { key: 'system', href: '/admin/system', labelKey: 'admin.nav.system', descKey: 'admin.nav.desc.system', icon: HardDrives, perms: ['platform.read'], hue: 'text-zinc-400' },
      { key: 'settings', href: '/admin/settings', labelKey: 'admin.nav.settings', descKey: 'admin.nav.desc.settings', icon: GearSix, perms: ['team.manage'], hue: 'text-zinc-300' },
    ],
  },
]

// Every console page sits in the nav; kept for imports that list extra pages.
export const ADMIN_MORE_PAGES: AdminNavItem[] = []

export function isNavActive(item: AdminNavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href || pathname === `${item.href}/`
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
