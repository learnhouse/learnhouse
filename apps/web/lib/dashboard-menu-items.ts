import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  ChalkboardSimple,
  Lightning,
  FolderSimple,
  Headphones,
  VideoCamera,
  ChartBar,
  Code,
  Circuitry,
  Garage,
  Newspaper,
} from '@phosphor-icons/react'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'

export interface DashboardMenuItem {
  id: string
  href: string
  icon: typeof House
  labelKey: string
  /** Feature key used for plan-based gating. If undefined, item is always shown. */
  featureKey?: string
  /** If true, the feature defaults to disabled (must be explicitly enabled). */
  defaultDisabled?: boolean
  /** Hides the item when it returns false (e.g. Enterprise-only pages). */
  available?: () => boolean
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
    id: 'paths',
    href: '/dash/paths',
    icon: Circuitry,
    labelKey: 'paths.title',
    featureKey: 'paths',
  },
  {
    id: 'library',
    href: '/dash/library',
    icon: FolderSimple,
    labelKey: 'library.library',
    featureKey: 'folders',
  },
  {
    id: 'communities',
    href: '/dash/communities',
    icon: Garage,
    labelKey: 'communities.title',
    featureKey: 'communities',
  },
  {
    id: 'podcasts',
    href: '/dash/podcasts',
    icon: Headphones,
    labelKey: 'podcasts.podcasts',
    featureKey: 'podcasts',
  },
  {
    id: 'live_sessions',
    href: '/dash/live-sessions',
    icon: VideoCamera,
    labelKey: 'live_sessions.title',
    featureKey: 'live_sessions',
  },
  {
    id: 'newsletter',
    href: '/dash/newsletter/overview',
    icon: Newspaper,
    labelKey: 'newsletter.common.title',
    featureKey: 'newsletter',
  },
  {
    id: 'boards',
    href: '/dash/boards',
    icon: ChalkboardSimple,
    labelKey: 'common.boards',
    featureKey: 'boards',
    defaultDisabled: true,
  },
  {
    id: 'playgrounds',
    href: '/dash/playgrounds',
    icon: Lightning,
    labelKey: 'common.playgrounds',
    featureKey: 'playgrounds',
    defaultDisabled: true,
  },
  {
    id: 'users',
    href: '/dash/users/settings/users',
    icon: Users,
    labelKey: 'common.users',
  },
  {
    id: 'payments',
    href: '/dash/payments/overview',
    icon: CurrencyCircleDollar,
    labelKey: 'common.payments',
    featureKey: 'payments',
  },
  {
    id: 'organization',
    href: '/dash/org/settings/overview',
    icon: Buildings,
    labelKey: 'common.organization',
  },
  {
    id: 'analytics',
    href: '/dash/analytics',
    icon: ChartBar,
    labelKey: 'common.analytics',
    available: isOrgAnalyticsAvailable,
  },
  {
    id: 'developers',
    href: '/dash/developers',
    icon: Code,
    labelKey: 'dashboard.developers.breadcrumb',
  },
]
