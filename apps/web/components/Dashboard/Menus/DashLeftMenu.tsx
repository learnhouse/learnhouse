'use client'
import dynamic from 'next/dynamic'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from '@components/Contexts/AuthContext'
import {
  Moon,
  Sun,
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  Globe,
  Question,
  Gear,
  SignOut,
  SidebarSimple,
  Check,
  CaretRight,
  PencilSimple,
  Book,
  ChatCircleDots,
  Headphones,
  VideoCamera,
  ChartBar,
  DotsThree,
  UsersThree,
  Shield,
  UserPlus,
  ClipboardText,
  Palette,
  Rocket,
  LinkSimple,
  Key,
  Lock,
  Wrench,
  ChartLine,
  MagnifyingGlass,
  ChalkboardSimple,
  ShoppingBag,
  FolderSimple,
  Plus,
  Code,
  Lightning,
  FlowArrow,
  Circuitry,
  SlidersHorizontal,
  Garage,
  Newspaper,
} from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { AIMark } from '@components/Objects/AI/AIBrand'
import { motion } from 'motion/react'
import { useAtlasMini } from '@ee/components/Atlas/AtlasMiniContext'
import AtlasNavItem from '@ee/components/Atlas/AtlasNavItem'
import TrainingNavItems from '@ee/components/HR/Training/TrainingNavItems'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import CommandPaletteTrigger from '@components/Dashboard/CommandPalette/CommandPaletteTrigger'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import { getLearnHouseVersion } from '@/lib/version'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg, getAPIUrl, getMainDomainUri, isMultiOrgModeEnabled } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/lib/i18n'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip"
import {
  HoverMenu,
  HoverMenuContent,
  HoverMenuItem,
  HoverMenuLabel,
  HoverMenuSeparator,
} from "@components/ui/hover-menu"
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import OrgSquareLogo, { hasOrgLogo, OrgInitial } from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { courseAssignmentsQuery } from '@/lib/query/dashQueries'
import { queryKeys } from '@/lib/query/keys'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getDeploymentMode } from '@services/config/config'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import {
  FEATURES_SETTINGS_HREF,
  OPTIONAL_FEATURES,
  OptionalFeatureKey,
  getOptionalFeatureState,
} from '@services/features/optionalFeatures'
import { usePlan } from '@components/Hooks/usePlan'
import { planMeetsRequirement } from '@services/plans/plans'
import useAdminStatus, { seesPlatformHubFromSession } from '@components/Hooks/useAdminStatus'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingSidebarBox from '@components/Dashboard/Onboarding/OnboardingSidebarBox'
import { useDashNavPrefetch } from '@components/Dashboard/Shared/useDashNavPrefetch'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import SidebarResizeHandle from './SidebarResizeHandle'
import { SIDEBAR_COLLAPSED_WIDTH, setSidebarPrefs, useSidebarPrefs } from './sidebarWidth'

// The dashboard bell; its dropdown loads on first open.
const NotificationBell = dynamic(() => import('@components/Notifications/NotificationBell'), { ssr: false })

// Shared looks. Rows are 32px with an 18px icon and a 14px label; the active
// row is a soft filled pill, hover is quieter still.
const MENU_ITEM_CLASS =
  'flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors'
const TOOLTIP_CLASS =
  'z-tooltip bg-[#1a1a1b] border-white/10 text-white text-xs px-2 py-1 shadow-lg shadow-black/20'
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-white/25'

function rowClass(active: boolean, collapsed: boolean) {
  return cn(
    'group/row relative flex items-center w-full h-8 rounded-lg text-sm font-medium transition-colors duration-150',
    FOCUS_RING,
    active ? 'bg-white/[0.08] text-white' : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90',
    collapsed ? 'justify-center' : 'gap-2.5 px-2.5'
  )
}

// Scattered night-sky starfield for the free-plan upgrade box. Fixed positions
// (top/left %) so the constellation is stable across renders; `north` is the
// brighter amber guide star. dim/bright drive the idle twinkle amplitude.
const UPGRADE_STARS: {
  top: string; left: string; size: number; delay: number; dim: number; bright: number; north?: boolean
}[] = [
  { top: '8%', left: '50%', size: 2.5, delay: 0.0, dim: 0.5, bright: 1, north: true },
  { top: '14%', left: '12%', size: 1, delay: 0.6, dim: 0.15, bright: 0.6 },
  { top: '10%', left: '30%', size: 1.5, delay: 1.1, dim: 0.2, bright: 0.7 },
  { top: '22%', left: '20%', size: 1, delay: 0.3, dim: 0.15, bright: 0.55 },
  { top: '30%', left: '38%', size: 1, delay: 1.5, dim: 0.1, bright: 0.5 },
  { top: '18%', left: '66%', size: 1.5, delay: 0.9, dim: 0.2, bright: 0.75 },
  { top: '26%', left: '78%', size: 1, delay: 0.2, dim: 0.15, bright: 0.6 },
  { top: '12%', left: '88%', size: 1, delay: 1.8, dim: 0.1, bright: 0.5 },
  { top: '34%', left: '60%', size: 1, delay: 1.3, dim: 0.15, bright: 0.55 },
  { top: '6%', left: '72%', size: 1, delay: 0.5, dim: 0.1, bright: 0.5 },
  { top: '32%', left: '90%', size: 1.5, delay: 1.0, dim: 0.2, bright: 0.65 },
  { top: '20%', left: '44%', size: 1, delay: 2.0, dim: 0.1, bright: 0.45 },
]


function DashLeftMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const { colorScheme, toggleColorScheme } = useColorScheme()
  const { track } = useLHAnalytics('dashboard')
  const pathname = usePathname() || ''
  // Width and collapsed state live in a small per-browser store; the server
  // renders the defaults and the stored values apply on the client.
  const sidebarPrefs = useSidebarPrefs()
  const isCollapsed = sidebarPrefs.collapsed
  const navRef = useRef<HTMLElement>(null)
  const [resizing, setResizing] = useState(false)
  // No width animation for the first frame, so a stored width doesn't slide
  // in from the default on load.
  const [animateWidth, setAnimateWidth] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateWidth(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const [upgradeHovered, setUpgradeHovered] = useState(false)
  // Onboarding takes over the search slot until setup is complete / dismissed.
  const onboarding = useOnboarding()
  const showOnboarding =
    !isCollapsed && onboarding.welcomeSeen && !onboarding.dismissed && !onboarding.allCompleted
  // The checklist is still running for this org (known, not put away, not done).
  const setupOpen = onboarding.loaded && !onboarding.dismissed && !onboarding.allCompleted
  const { available: atlasAvailable } = useAtlasMini()
  // Hover/focus on any link below warms its page and data before the click.
  const navPrefetch = useDashNavPrefetch()

  const isActivePath = (path: string) => {
    if (path === '/dash') {
      return pathname === '/dash' || pathname === '/dash/'
    }
    return pathname === path || pathname.startsWith(path + '/')
  }
  const [recentAssignments, setRecentAssignments] = useState<any[]>([])
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  // Fetch recent courses
  const { data: coursesData } = useQuery({
    queryKey: [...queryKeys.courses.list(org?.slug || ''), 'recent', 8],
    queryFn: async () => {
      const url = `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/8`
      const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, access_token))
      if (!res.ok) throw new Error('Failed to fetch courses')
      return res.json()
    },
    enabled: !!org?.slug,
    staleTime: 60_000,
  })
  const recentCourses = coursesData?.slice(0, 8) || []

  // Lazy-load assignments only when the assignments hover menu is opened
  const [assignmentsFetched, setAssignmentsFetched] = useState(false)

  const fetchAssignments = () => {
    if (assignmentsFetched || !coursesData || !access_token) return
    setAssignmentsFetched(true)
    const coursesToFetch = coursesData.slice(0, 5)
    // The assignments page's own cache entries: whichever asks first (this
    // menu, the page or its hover prefetch) serves the others.
    const promises = coursesToFetch.map((course: any) =>
      queryClient.fetchQuery(courseAssignmentsQuery(course.course_uuid, access_token))
    )
    Promise.all(promises).then((results) => {
      const allAssignments: any[] = []
      results.forEach((list: any[], index: number) => {
        list.forEach((assignment: any) => {
          allAssignments.push({
            ...assignment,
            courseName: coursesToFetch[index].name
          })
        })
      })
      setRecentAssignments(allAssignments.slice(0, 8))
    }).catch(() => {})
  }

  const toggleCollapse = () => setSidebarPrefs({ collapsed: !isCollapsed })


  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }


  const plan = usePlan()
  const mode = getDeploymentMode()
  // Only org managers (admins/superadmins) see billing surfaces; non-admins
  // shouldn't manage the plan/subscription.
  const { canManageOrg } = useAdminStatus()

  if (!org || !session) return null
  const planLabel =
    mode === 'ee' ? t('dashboard.nav.enterprise_edition') :
    mode === 'oss' ? 'OSS' :
    plan  // SaaS: show actual plan name

  // Multi-org (SaaS) hub: the apex /home, /new, /billing routes only exist in
  // multi tenancy. The user's organizations (deduped) come from the session.
  const multiOrg = isMultiOrgModeEnabled()
  const lhVersion = getLearnHouseVersion()
  // The free-plan upgrade box brings its own grid; the footer backdrop steps
  // aside while it shows.
  const showFooterBackdrop = !(multiOrg && plan === 'free' && !isCollapsed && canManageOrg)
  const myOrgs: any[] = (() => {
    const roles = session?.data?.roles || []
    const seen = new Set<number>()
    const orgs: any[] = []
    for (const r of roles) {
      const o = r?.org
      if (o && o.id != null && !seen.has(o.id)) { seen.add(o.id); orgs.push(o) }
    }
    return orgs
  })()
  // Staff of a single school (an instructor, say) have no use for the platform
  // hub or for creating organizations; only people who run one do.
  const managesAnyOrg = seesPlatformHubFromSession(session)
  // Any second organization, the demo included, is somewhere to switch back from.
  const showOrgSwitcher = managesAnyOrg || myOrgs.length > 1
  // A small dot next to the plan name; the name itself stays muted.
  const planDotColor =
    mode === 'ee' ? 'bg-amber-300' :
    mode === 'oss' ? 'bg-green-300' :
    plan === 'enterprise' ? 'bg-amber-300' :
    plan === 'pro' ? 'bg-purple-300' :
    plan === 'standard' ? 'bg-blue-300' :
    'bg-white/30'

  // Optional features: 'on' ones get a nav item, the rest are listed in the
  // "More" menu, split into turned off (a settings change away) and locked
  // (an upgrade away).
  const rf = org?.config?.config?.resolved_features
  const featureStates = OPTIONAL_FEATURES.map((feature) => ({
    feature,
    ...getOptionalFeatureState(rf?.[feature.key]),
  }))
  const isOn = (key: OptionalFeatureKey) =>
    featureStates.find((f) => f.feature.key === key)?.status === 'on'
  const offFeatures = featureStates.filter((f) => f.status === 'off')
  const lockedFeatures = featureStates.filter((f) => f.status === 'locked')

  const showLibrary = isOn('folders')
  const showPaths = isOn('paths')
  const showCommunities = isOn('communities')
  const showPodcasts = isOn('podcasts')
  const showLiveSessions = isOn('live_sessions')
  const showBoards = isOn('boards')
  const showPlaygrounds = isOn('playgrounds')
  const showPayments = isOn('payments')
  const showNewsletter = isOn('newsletter')
  // Companies (customers with their own spaces): EE, Pro plan.
  const showCustomers = getDeploymentMode() !== 'oss' && rf?.company_seats?.enabled === true
  // Org analytics ship with Enterprise Edition.
  const showAnalytics = isOrgAnalyticsAvailable()
  const showEngage = showCommunities || showPodcasts || showLiveSessions || showBoards || showNewsletter

  // When the user is on the Atlas page, the left nav drops into a slightly
  // darker flat dark color than the Atlas content (same family), with the
  // nav reading as a deeper "shelf" the brighter content sits beside.
  const isOnAtlas = atlasAvailable && pathname.startsWith('/dash/atlas')

  // Collapsed-rail tooltips open toward the content.
  const tooltipSide = i18n.dir?.(i18n.language) === 'rtl' ? 'left' : 'right'
  const footerIconClass = cn(
    'flex items-center justify-center h-8 shrink-0 rounded-lg text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors',
    FOCUS_RING,
    isCollapsed ? 'w-full' : 'w-8'
  )

  return (
    <TooltipProvider delayDuration={0}>
    <nav
      {...navPrefetch}
      ref={navRef}
      aria-label={t('dashboard.nav.sidebar_navigation')}
      data-duotone="strong"
      style={{ width: isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarPrefs.width }}
      className={cn(
        "isolate flex flex-col shrink-0 text-white h-screen sticky top-0 z-overlay border-e",
        animateWidth && !resizing && "transition-[width] duration-200 ease-lh-out",
        isOnAtlas
          ? "bg-[#05040c] border-white/5"
          // lh-dash-sidebar: in dark mode it takes the page color (styles/dark.css).
          : "lh-dash-sidebar bg-[#0f0f10] border-white/[0.08]"
      )}
    >
      {/* Footer backdrop: a fine dot grid (grid lines cut through the rows) and a
          soft neutral glow rising from the bottom (colour gradients are kept
          for AI features).
          Decorative only; it sits under the rows (isolate + -z-10). The free
          plan upgrade box brings its own pattern, so this steps aside then. */}
      {/* Header backdrop: the same dot grid and glow, mirrored so it fades
          down from the org header. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44 -z-10 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1.2px)',
            backgroundSize: '14px 14px',
            backgroundPosition: 'center top',
            maskImage: 'radial-gradient(130% 100% at 50% 0%, black 0%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(130% 100% at 50% 0%, black 0%, transparent 72%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 75% at 50% -15%, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.03) 45%, transparent 75%)',
          }}
        />
      </div>
      {showFooterBackdrop && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-56 -z-10 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1.2px)',
              backgroundSize: '14px 14px',
              backgroundPosition: 'center bottom',
              maskImage: 'radial-gradient(130% 100% at 50% 100%, black 0%, transparent 72%)',
              WebkitMaskImage: 'radial-gradient(130% 100% at 50% 100%, black 0%, transparent 72%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 75% at 50% 115%, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.03) 45%, transparent 75%)',
            }}
          />
        </div>
      )}
      {/* Clips labels while the width animates; the resize handle and the
          flyouts sit outside it. */}
      <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      {/* Header: org logo and name, plan as a quiet caption, collapse toggle */}
      <div className={cn(
        "relative flex items-center h-14 shrink-0 gap-1",
        isCollapsed ? "justify-center px-2" : "ps-2.5 pe-2"
      )}>
        <Link
          className={cn(
            "flex items-center min-w-0 rounded-lg p-1 transition-colors hover:bg-white/[0.04]",
            FOCUS_RING,
            isCollapsed ? "" : "flex-1 gap-2.5"
          )}
          href={'/'}
        >
          {(planMeetsRequirement(plan, 'standard') && hasOrgLogo(org)) || isWhiteLabelPlan(plan) ? (
            <div className="h-7 w-7 rounded-md overflow-hidden bg-white shrink-0">
              <OrgSquareLogo org={org} wideInsetClassName="p-0.5" fallback={isWhiteLabelPlan(plan) ? <OrgInitial org={org} /> : <img src="/lrn.svg" alt="LearnHouse" className="w-full h-full object-contain p-1" />} />
            </div>
          ) : (
            <img
              src="/lrn-dash.svg"
              alt="Learnhouse logo"
              className="h-7 w-7 shrink-0"
            />
          )}
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="font-semibold text-[13px] text-white truncate">
                {org?.name}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[11px] text-white/40">
                <span aria-hidden="true" className={cn("size-1.5 rounded-full shrink-0", planDotColor)} />
                <span className="truncate capitalize">{planLabel}</span>
              </span>
            </div>
          )}
        </Link>

        {/* Needs-attention notifications (admin audience), beside the
            collapse toggle; the dropdown opens past the sidebar's edge. */}
        {!isCollapsed && (
          <NotificationBell
            audience="admin"
            side={tooltipSide}
            align="start"
            iconSize={17}
            iconWeight="duotone"
            badgeRing="ring-[#0f0f10]"
            badgeClass="-top-1 -end-1"
            escape="nav"
            tooltipSide={tooltipSide}
            className={cn("p-1.5 rounded-md shrink-0 text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors", FOCUS_RING)}
          />
        )}
        {!isCollapsed && (
          <button
            aria-label={t('dashboard.nav.collapse_sidebar')}
            onClick={toggleCollapse}
            className={cn(
              "p-1.5 rounded-md shrink-0 text-white/30 hover:text-white hover:bg-white/[0.06] transition-colors",
              FOCUS_RING
            )}
          >
            <SidebarSimple size={16} weight="regular" data-dir-flip="" />
          </button>
        )}

        {/* Onboarding progress along the header's bottom edge: a quiet
            neutral line (colored gradients are reserved for AI). */}
        {showOnboarding && (
          <>
            <div className="absolute -bottom-px start-0 end-0 h-px bg-white/[0.06]" />
            <motion.div
              className="absolute -bottom-px start-0 h-px bg-white/40"
              initial={false}
              animate={{ width: `${Math.max(onboarding.progress * 100, 6)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </>
        )}
      </div>

      {/* Search trigger, replaced by the onboarding progress in this slot until
          setup is complete (then the search box returns). */}
      <div className={cn('shrink-0', isCollapsed ? 'px-2' : 'px-3', showOnboarding ? 'pt-2' : 'pt-0.5')}>
        {showOnboarding ? (
          <OnboardingSidebarBox />
        ) : (
          <CommandPaletteTrigger isCollapsed={isCollapsed} />
        )}
      </div>

      {/* Main navigation, grouped. Starts right under the search box and
          scrolls once it outgrows the viewport. No `overscroll-contain`: it
          stops the wheel from scrolling the page over the sidebar even when
          the list fits. */}
      <div className={cn("flex-1 min-h-0 overflow-y-auto pt-2 pb-3", isCollapsed ? "px-2" : "px-2.5")}>
        <AdminAuthorization authorizationMode="component">
          <div className="flex flex-col gap-px">
            <NavRow
              href="/dash"
              icon={House}
              label={t('common.home')}
              collapsed={isCollapsed}
              tooltipSide={tooltipSide}
              active={isActivePath('/dash')}
              onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: 'home' })}
            />
            <AtlasNavItem isCollapsed={isCollapsed} isActive={isActivePath('/dash/atlas')} />
            <NavRow
              href="/dash/website"
              icon={Globe}
              label={t('website.title')}
              collapsed={isCollapsed}
              tooltipSide={tooltipSide}
              active={isActivePath('/dash/website') || isActivePath('/dash/org/landing-builder')}
              onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: 'website' })}
            />
          </div>

          <NavSection label={t('dashboard.nav.section_content', { defaultValue: 'Content' })} collapsed={isCollapsed}>
            {/* Courses with hover menu */}
            <HoverMenu
              anchorRef={navRef}
              content={
                <HoverMenuContent className="w-64">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('courses.courses')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/courses" className={MENU_ITEM_CLASS}>
                      <BookOpen size={16} weight="duotone" />
                      <span>{t('common.all_courses')}</span>
                    </Link>
                  </HoverMenuItem>
                  {recentCourses.length > 0 && (
                    <>
                      <HoverMenuSeparator />
                      <HoverMenuLabel className="text-white/40">{t('common.recent')}</HoverMenuLabel>
                      {recentCourses.map((course: any) => (
                        <HoverMenuItem key={course.course_uuid} asChild>
                          <Link
                            href={`/dash/courses/course/${course.course_uuid.replace('course_', '')}/settings`}
                            className={MENU_ITEM_CLASS}
                          >
                            <PencilSimple size={14} className="text-white/40" />
                            <span className="truncate">{course.name}</span>
                          </Link>
                        </HoverMenuItem>
                      ))}
                    </>
                  )}
                </HoverMenuContent>
              }
            >
              <NavRow
                href="/dash/courses"
                icon={BookOpen}
                label={t('courses.courses')}
                ariaLabel={t('dashboard.nav.open_courses_menu')}
                collapsed={isCollapsed}
                active={isActivePath('/dash/courses')}
                hasMenu
              />
            </HoverMenu>

            {/* Assignments with hover menu */}
            <div onMouseEnter={fetchAssignments}>
            <HoverMenu
              anchorRef={navRef}
              content={
                <HoverMenuContent className="w-72">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('common.assignments')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/assignments" className={MENU_ITEM_CLASS}>
                      <Files size={16} weight="duotone" />
                      <span>{t('common.all_assignments')}</span>
                    </Link>
                  </HoverMenuItem>
                  {recentAssignments.length > 0 && (
                    <>
                      <HoverMenuSeparator />
                      <HoverMenuLabel className="text-white/40">{t('common.recent')}</HoverMenuLabel>
                      {recentAssignments.map((assignment: any) => (
                        <HoverMenuItem key={assignment.assignment_uuid} asChild>
                          <Link
                            href={`/dash/assignments/${assignment.assignment_uuid.replace('assignment_', '')}?subpage=editor`}
                            className={MENU_ITEM_CLASS}
                          >
                            <PencilSimple size={14} className="text-white/40" />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{assignment.title}</span>
                              <span className="text-xs text-white/30 truncate">{assignment.courseName}</span>
                            </div>
                          </Link>
                        </HoverMenuItem>
                      ))}
                    </>
                  )}
                </HoverMenuContent>
              }
            >
              <NavRow
                href="/dash/assignments"
                icon={Files}
                label={t('common.assignments')}
                ariaLabel={t('dashboard.nav.open_assignments_menu')}
                collapsed={isCollapsed}
                active={isActivePath('/dash/assignments')}
                hasMenu
              />
            </HoverMenu>
            </div>
            {showPaths && (
              <NavRow
                href="/dash/paths"
                icon={Circuitry}
                label={t('paths.title')}
                collapsed={isCollapsed}
                tooltipSide={tooltipSide}
                active={isActivePath('/dash/paths')}
              />
            )}
            {showLibrary && (
              <NavRow
                href="/dash/library"
                icon={FolderSimple}
                label={t('library.library')}
                collapsed={isCollapsed}
                tooltipSide={tooltipSide}
                active={isActivePath('/dash/library')}
              />
            )}
            {showPlaygrounds && (
              <NavRow
                href="/dash/playgrounds"
                icon={Lightning}
                label={t('common.playgrounds')}
                collapsed={isCollapsed}
                tooltipSide={tooltipSide}
                active={isActivePath('/dash/playgrounds')}
              />
            )}
          </NavSection>

          {showEngage && (
            <NavSection label={t('dashboard.nav.section_engage', { defaultValue: 'Engage' })} collapsed={isCollapsed}>
              {showCommunities && (
                <NavRow
                  href="/dash/communities"
                  icon={Garage}
                  label={t('communities.title')}
                  collapsed={isCollapsed}
                  tooltipSide={tooltipSide}
                  active={isActivePath('/dash/communities')}
                />
              )}
              {showPodcasts && (
                <NavRow
                  href="/dash/podcasts"
                  icon={Headphones}
                  label={t('podcasts.podcasts')}
                  collapsed={isCollapsed}
                  tooltipSide={tooltipSide}
                  active={isActivePath('/dash/podcasts')}
                />
              )}
              {showLiveSessions && (
                <NavRow
                  href="/dash/live-sessions"
                  icon={VideoCamera}
                  label={t('live_sessions.title')}
                  collapsed={isCollapsed}
                  tooltipSide={tooltipSide}
                  active={isActivePath('/dash/live-sessions')}
                />
              )}
              {showBoards && (
                <NavRow
                  href="/dash/boards"
                  icon={ChalkboardSimple}
                  label={t('boards.boards')}
                  collapsed={isCollapsed}
                  tooltipSide={tooltipSide}
                  active={isActivePath('/dash/boards')}
                />
              )}
              {showNewsletter && (
                <NavRow
                  href="/dash/newsletter/overview"
                  icon={Newspaper}
                  label={t('newsletter.common.title')}
                  collapsed={isCollapsed}
                  tooltipSide={tooltipSide}
                  active={isActivePath('/dash/newsletter')}
                />
              )}
            </NavSection>
          )}

          <NavSection label={t('dashboard.nav.section_people', { defaultValue: 'People & business' })} collapsed={isCollapsed}>
            {/* Users with hover menu */}
            <HoverMenu
              anchorRef={navRef}
              content={
                <HoverMenuContent className="w-64">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('common.users')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/users/settings/users" className={MENU_ITEM_CLASS}>
                      <Users size={16} weight="duotone" />
                      <span>{t('dashboard.users.settings.tabs.users')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/users/settings/usergroups" className={MENU_ITEM_CLASS}>
                      <UsersThree size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.users.settings.tabs.usergroups')}<PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/users/settings/roles" className={MENU_ITEM_CLASS}>
                      <Shield size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.users.settings.tabs.roles')}<PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/users/settings/signups" className={MENU_ITEM_CLASS}>
                      <ClipboardText size={16} weight="duotone" />
                      <span>{t('dashboard.users.settings.tabs.signups')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/users/settings/add" className={MENU_ITEM_CLASS}>
                      <UserPlus size={16} weight="duotone" />
                      <span>{t('dashboard.users.settings.tabs.add')}</span>
                    </Link>
                  </HoverMenuItem>
                </HoverMenuContent>
              }
            >
              <NavRow
                href="/dash/users/settings/users"
                icon={Users}
                label={t('common.users')}
                ariaLabel={t('dashboard.nav.open_users_menu')}
                collapsed={isCollapsed}
                active={isActivePath('/dash/users')}
                hasMenu
              />
            </HoverMenu>

            {/* Required training (admins) and My team (managers), EE */}
            <TrainingNavItems NavRow={NavRow} collapsed={isCollapsed} tooltipSide={tooltipSide} isActivePath={isActivePath} />

            {showPayments && (
              <NavRow
                href="/dash/payments/overview"
                icon={CurrencyCircleDollar}
                label={t('common.payments')}
                collapsed={isCollapsed}
                tooltipSide={tooltipSide}
                active={isActivePath('/dash/payments')}
              />
            )}

            {showCustomers && (
              <NavRow
                href="/dash/customers"
                icon={Buildings}
                label={t('companies.title')}
                collapsed={isCollapsed}
                tooltipSide={tooltipSide}
                active={isActivePath('/dash/customers')}
              />
            )}

            {/* Analytics with hover menu */}
            {showAnalytics && (
              <HoverMenu
                anchorRef={navRef}
                content={
                  <HoverMenuContent className="w-64">
                    <HoverMenuLabel className="text-white/70 font-medium">{t('common.analytics')}</HoverMenuLabel>
                    <HoverMenuSeparator />
                    <HoverMenuItem asChild>
                      <Link href="/dash/analytics" className={MENU_ITEM_CLASS}>
                        <ChartBar size={16} weight="duotone" />
                        <span>{t('analytics.tabs.overview')}</span>
                      </Link>
                    </HoverMenuItem>
                    <HoverMenuItem asChild>
                      <Link href="/dash/analytics" className={MENU_ITEM_CLASS}>
                        <ChartLine size={16} weight="duotone" />
                        <span className="flex items-center">{t('analytics.tabs.advanced')}<PlanBadge currentPlan={plan} requiredPlan="enterprise" variant="dark" /></span>
                      </Link>
                    </HoverMenuItem>
                  </HoverMenuContent>
                }
              >
                <NavRow
                  href="/dash/analytics"
                  icon={ChartBar}
                  label={t('common.analytics')}
                  collapsed={isCollapsed}
                  active={isActivePath('/dash/analytics')}
                  hasMenu
                />
              </HoverMenu>
            )}
          </NavSection>

          <NavSection label={t('dashboard.nav.section_settings', { defaultValue: 'Settings' })} collapsed={isCollapsed}>
            {/* Organization with hover menu */}
            <HoverMenu
              anchorRef={navRef}
              content={
                <HoverMenuContent className="w-64">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('common.organization')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/org/settings/overview" className={MENU_ITEM_CLASS}>
                      <ChartBar size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.overview')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/org/settings/general" className={MENU_ITEM_CLASS}>
                      <Gear size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.general')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href={FEATURES_SETTINGS_HREF} className={MENU_ITEM_CLASS}>
                      <SlidersHorizontal size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.features')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/org/settings/branding" className={MENU_ITEM_CLASS}>
                      <Palette size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.branding')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/website" className={MENU_ITEM_CLASS}>
                      <Globe size={16} weight="duotone" />
                      <span>{t('website.title')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/org/settings/ai" className={MENU_ITEM_CLASS}>
                      <AIMark variant="app" size={16} alt="" />
                      <span className="flex items-center">{t('dashboard.organization.settings.tabs.ai')}<PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/org/settings/other" className={MENU_ITEM_CLASS}>
                      <Wrench size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.other')}</span>
                    </Link>
                  </HoverMenuItem>
                </HoverMenuContent>
              }
            >
              <NavRow
                href="/dash/org/settings/overview"
                icon={Buildings}
                label={t('common.organization')}
                ariaLabel={t('dashboard.nav.open_organization_menu')}
                collapsed={isCollapsed}
                active={isActivePath('/dash/org')}
                hasMenu
              />
            </HoverMenu>

            {/* Developers with hover menu */}
            <HoverMenu
              anchorRef={navRef}
              content={
                <HoverMenuContent className="w-64">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' })}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers" className={MENU_ITEM_CLASS}>
                      <Code size={16} weight="duotone" />
                      <span>{t('dashboard.developers.nav.overview', { defaultValue: 'Overview' })}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers/api" className={MENU_ITEM_CLASS}>
                      <Key size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.organization.settings.tabs.api', { defaultValue: 'API Access' })}<PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers/automations" className={MENU_ITEM_CLASS}>
                      <FlowArrow size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' })}<PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers/domains" className={MENU_ITEM_CLASS}>
                      <LinkSimple size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.organization.settings.tabs.domains', { defaultValue: 'Domains' })}<PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers/seo" className={MENU_ITEM_CLASS}>
                      <MagnifyingGlass size={16} weight="duotone" />
                      <span>{t('dashboard.organization.settings.tabs.seo')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href="/dash/developers/sso" className={MENU_ITEM_CLASS}>
                      <Lock size={16} weight="duotone" />
                      <span className="flex items-center">{t('dashboard.organization.settings.tabs.sso', { defaultValue: 'SSO' })}<PlanBadge currentPlan={plan} requiredPlan="enterprise" variant="dark" /></span>
                    </Link>
                  </HoverMenuItem>
                </HoverMenuContent>
              }
            >
              <NavRow
                href="/dash/developers"
                icon={Code}
                label={t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' })}
                ariaLabel={t('dashboard.nav.open_developers_menu')}
                collapsed={isCollapsed}
                active={isActivePath('/dash/developers')}
                hasMenu
              />
            </HoverMenu>

            {/* Optional features that are not in the nav: turned off, or not in the plan */}
            {(offFeatures.length > 0 || lockedFeatures.length > 0) && (
              <HoverMenu
                anchorRef={navRef}
                content={
                  <HoverMenuContent className="w-64">
                    {offFeatures.length > 0 && (
                      <>
                        <HoverMenuLabel className="text-white/50 text-xs font-medium">
                          {t('dashboard.nav.features_off')}
                        </HoverMenuLabel>
                        {offFeatures.map(({ feature }) => (
                          <HoverMenuItem key={feature.key} asChild>
                            <Link href={feature.href} className="flex items-center gap-2 px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.05] cursor-pointer transition-colors">
                              <feature.Icon size={16} weight="duotone" />
                              <span className="flex-1">{t(feature.labelKey)}</span>
                              <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/35">
                                {t('dashboard.nav.feature_off_badge')}
                              </span>
                            </Link>
                          </HoverMenuItem>
                        ))}
                      </>
                    )}
                    {offFeatures.length > 0 && lockedFeatures.length > 0 && <HoverMenuSeparator />}
                    {lockedFeatures.length > 0 && (
                      <>
                        <HoverMenuLabel className="text-white/50 text-xs font-medium">
                          {t('dashboard.nav.features_locked')}
                        </HoverMenuLabel>
                        {lockedFeatures.map(({ feature, upgradePlan }) => (
                          <HoverMenuItem key={feature.key} asChild>
                            <Link href={feature.href} className="flex items-center gap-2 px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.05] cursor-pointer transition-colors">
                              <feature.Icon size={16} weight="duotone" />
                              <span className="flex-1">{t(feature.labelKey)}</span>
                              {upgradePlan && (
                                <PlanBadge currentPlan={plan} requiredPlan={upgradePlan} variant="dark" alwaysShow noMargin />
                              )}
                            </Link>
                          </HoverMenuItem>
                        ))}
                      </>
                    )}
                    {canManageOrg && (
                      <>
                        <HoverMenuSeparator />
                        <HoverMenuItem asChild>
                          <Link href={FEATURES_SETTINGS_HREF} className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/[0.05] cursor-pointer transition-colors">
                            <SlidersHorizontal size={16} weight="bold" />
                            <span>{t('dashboard.nav.manage_features')}</span>
                          </Link>
                        </HoverMenuItem>
                      </>
                    )}
                  </HoverMenuContent>
                }
              >
                <button
                  type="button"
                  aria-label={t('dashboard.nav.more_features')}
                  className={cn(
                    "group/row flex items-center w-full h-8 rounded-lg text-sm font-medium text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-colors",
                    FOCUS_RING,
                    isCollapsed ? "justify-center" : "gap-2.5 px-2.5"
                  )}
                >
                  <DotsThree size={18} weight="bold" className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 min-w-0 truncate text-start">{t('dashboard.nav.more_features')}</span>
                      <CaretRight aria-hidden="true" size={12} weight="bold" className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 rtl:rotate-180" />
                    </>
                  )}
                </button>
              </HoverMenu>
            )}
          </NavSection>
        </AdminAuthorization>
      </div>

      {/* Free-plan upgrade box: replaces the old full-width top banner.
          Sits in the sidebar's empty space; multi-org / SaaS, free plan only.
          Twinkling stars on top; on hover it reveals the premium features the
          org is missing, the gold glow swells and the button sweeps a shimmer. */}
      {/* Hidden while the setup checklist is open: it already links to the plans. */}
      {multiOrg && plan === 'free' && !isCollapsed && canManageOrg && !setupOpen && (
        <motion.div
          className="relative overflow-hidden shrink-0 px-4 pt-6 pb-4"
          onHoverStart={() => setUpgradeHovered(true)}
          onHoverEnd={() => setUpgradeHovered(false)}
        >
          {/* Blueprint grid, same motif as the login/home pages, fading in
              from the bottom. No card/border; it blends into the sidebar. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
              backgroundSize: '56px 56px, 56px 56px, 14px 14px, 14px 14px',
              maskImage: 'linear-gradient(to top, black 0%, transparent 80%)',
              WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 80%)',
            }}
          />
          {/* Gold glow rising from the bottom; swells on hover. */}
          <motion.div
            className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
            initial={false}
            animate={{ opacity: upgradeHovered ? 1 : 0.5 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            style={{
              background:
                'radial-gradient(120% 90% at 50% 100%, rgba(250,204,21,0.12), rgba(255,255,255,0.05) 38%, transparent 72%)',
            }}
          />
          {/* Night-sky starfield: scattered points of light that twinkle and
              brighten on hover. The single amber "north star" is the plan you're
              reaching for; the white stars are the features it unlocks below. */}
          <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none">
            {UPGRADE_STARS.map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full"
                style={{
                  top: s.top,
                  left: s.left,
                  width: s.size,
                  height: s.size,
                  background: s.north ? 'rgb(252,211,77)' : 'rgba(255,255,255,0.95)',
                  boxShadow: s.north
                    ? '0 0 6px 1px rgba(250,204,21,0.7)'
                    : s.size >= 2
                      ? '0 0 4px 0.5px rgba(255,255,255,0.6)'
                      : 'none',
                }}
                animate={{
                  opacity: upgradeHovered ? [s.dim + 0.2, 1, s.dim + 0.2] : [s.dim, s.bright, s.dim],
                  scale: upgradeHovered ? [1, s.north ? 1.5 : 1.7, 1] : [1, 1.2, 1],
                }}
                transition={{
                  duration: (upgradeHovered ? 1.3 : 2.4) + s.size * 0.3,
                  repeat: Infinity,
                  delay: s.delay,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          <motion.div layout className="relative">
            {/* Plan badge + CTA headline (replaces the plain "Free plan" title). */}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/10 text-white/55 text-[8px] font-bold uppercase tracking-wider">
              {t('plan.free_plan_title', { defaultValue: 'Free plan' })}
            </span>
            <p className="mt-2 text-[13px] font-bold text-white leading-tight">
              {t('plan.free_plan_cta', { defaultValue: 'Unlock the full platform' })}
            </p>

            {/* Stable one-line pitch: no layout shift on hover; hover only
                intensifies the gold glow / starfield / button halo. */}
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              {t('plan.free_plan_desc', {
                defaultValue: 'Everything you need to teach, sell & grow.',
              })}
            </p>

            <motion.a
              href={getMainDomainUri(`/billing?org=${org?.slug ?? ''}`)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              animate={{
                boxShadow: upgradeHovered
                  ? '0 0 0 1px rgba(250,204,21,0.5), 0 8px 24px -6px rgba(250,204,21,0.35)'
                  : '0 0 0 0 rgba(250,204,21,0)',
              }}
              transition={{ duration: 0.35 }}
              className="mt-3 relative overflow-hidden flex items-center justify-center gap-1.5 w-full rounded-lg bg-white text-[#0f0f10] text-[13px] font-semibold py-2"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                <Rocket size={13} weight="duotone" />
                {t('plan.upgrade', { defaultValue: 'Upgrade' })}
              </span>
              {/* Diagonal shimmer sweep across the button. */}
              <motion.span
                aria-hidden
                className="absolute top-0 bottom-0 w-1/3 -skew-x-12 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(0,0,0,0.07), transparent)',
                }}
                animate={{ left: ['-40%', '140%'] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  repeatDelay: upgradeHovered ? 0.4 : 2,
                  ease: 'easeInOut',
                }}
              />
            </motion.a>
          </motion.div>
        </motion.div>
      )}

      {/* Footer: the user, with Help, Language and (multi-org) Organizations
          as small icon buttons beside it. Every flyout opens past the
          sidebar's edge (anchorRef), not over the neighbouring buttons. */}
      <div className={cn("shrink-0 p-2", !showFooterBackdrop && "border-t border-white/[0.06]", isCollapsed && "flex flex-col gap-1")}>
        {/* Expand button when collapsed */}
        {isCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={t('dashboard.nav.expand_sidebar')}
                onClick={toggleCollapse}
                className={footerIconClass}
              >
                <SidebarSimple size={18} weight="regular" data-dir-flip="" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} className={TOOLTIP_CLASS}>
              {t('common.expand')}
            </TooltipContent>
          </Tooltip>
        )}

        <div className={cn("flex items-center", isCollapsed ? "flex-col-reverse gap-1" : "gap-0.5")}>
          {/* User Menu with hover menu */}
          <div className={cn("min-w-0", isCollapsed ? "w-full" : "flex-1")}>
            <HoverMenu
              anchorRef={navRef}
              align="end"
                            content={
                <HoverMenuContent className="w-56">
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-white/90">{session?.data?.user?.username}</p>
                    <p className="text-xs text-white/40">{session?.data?.user?.email}</p>
                  </div>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/account/general" className={MENU_ITEM_CLASS}>
                      <Gear size={16} weight="duotone" />
                      <span>{t('common.settings')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <Link href={getUriWithOrg(org?.slug, '/account/purchases')} className={MENU_ITEM_CLASS}>
                      <ShoppingBag size={16} weight="duotone" />
                      <span>{t('account.purchases')}</span>
                    </Link>
                  </HoverMenuItem>
                  <HoverMenuItem asChild>
                    <button type="button" onClick={toggleColorScheme} className={cn(MENU_ITEM_CLASS, 'w-full')} data-testid="dash-theme-toggle">
                      {colorScheme === 'dark' ? <Sun size={16} weight="duotone" /> : <Moon size={16} weight="duotone" />}
                      <span>{colorScheme === 'dark' ? t('common.switch_to_light') : t('common.switch_to_dark')}</span>
                    </button>
                  </HoverMenuItem>
                  <HoverMenuSeparator />
                  <HoverMenuItem
                    onClick={() => logOutUI()}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:text-red-400 hover:bg-white/[0.08] cursor-pointer transition-colors"
                  >
                    <SignOut size={16} weight="duotone" data-dir-flip />
                    <span>{t('user.sign_out')}</span>
                  </HoverMenuItem>
                </HoverMenuContent>
              }
            >
              <button
                type="button"
                aria-label={t('dashboard.nav.open_account_menu', { defaultValue: 'Open account menu' })}
                className={cn(
                  "flex items-center w-full h-9 rounded-lg text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors",
                  FOCUS_RING,
                  isCollapsed ? "justify-center" : "gap-2.5 px-1.5"
                )}
              >
                <span className="shrink-0">
                  <UserAvatar width={24} rounded="rounded-full" shadow="shadow-none" />
                </span>
                {!isCollapsed && (
                  <span className="text-[13px] font-medium truncate text-start flex-1 min-w-0">
                    {session?.data?.user?.username}
                  </span>
                )}
              </button>
            </HoverMenu>
          </div>

          {/* Collapsed sidebar: the needs-attention bell sits with the footer icons. */}
          {isCollapsed && (
            <NotificationBell
              audience="admin"
              side={tooltipSide}
              align="end"
              iconSize={18}
              iconWeight="duotone"
              badgeRing="ring-[#0f0f10]"
              badgeClass="-top-0.5 -end-0.5"
              escape="nav"
              tooltipSide={tooltipSide}
              className={footerIconClass}
            />
          )}

          {/* Help with hover menu */}
          <HoverMenu
            anchorRef={navRef}
            align="end"
                        content={
              <HoverMenuContent className="w-56">
                <HoverMenuLabel className="flex items-center gap-2 text-white/70 font-medium">
                  <Question size={16} weight="duotone" />
                  <span>{t('common.help')}</span>
                </HoverMenuLabel>
                <HoverMenuSeparator />
                <HoverMenuItem asChild>
                  <a
                    href="https://docs.learnhouse.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={MENU_ITEM_CLASS}
                  >
                    <Book size={16} weight="duotone" />
                    <span>{t('common.help_menu.documentation')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://learnhouse.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={MENU_ITEM_CLASS}
                  >
                    <Globe size={16} weight="duotone" />
                    <span>{t('common.help_menu.website')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="http://learnhouse.to/discord"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={MENU_ITEM_CLASS}
                  >
                    <DiscordIcon size={16} />
                    <span>{t('common.help_menu.discord')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuSeparator />
                <HoverMenuItem
                  onClick={() => setFeedbackModalOpen(true)}
                  className={MENU_ITEM_CLASS}
                >
                  <ChatCircleDots size={16} weight="duotone" />
                  <span>{t('common.help_menu.report_feedback')}</span>
                </HoverMenuItem>
              </HoverMenuContent>
            }
          >
            <button type="button" aria-label={t('dashboard.nav.open_help_menu')} className={footerIconClass}>
              <Question size={18} weight="duotone" />
            </button>
          </HoverMenu>

          {/* Language Switcher with hover menu */}
          <HoverMenu
            anchorRef={navRef}
            align="end"
                        content={
              <HoverMenuContent className="w-64 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <HoverMenuLabel className="flex items-center gap-2 text-white/70 font-medium">
                  <Globe size={16} weight="duotone" />
                  <span>{t('common.language')}</span>
                </HoverMenuLabel>
                <HoverMenuSeparator />
                {AVAILABLE_LANGUAGES.map((language) => (
                  <HoverMenuItem
                    key={language.code}
                    onClick={() => changeLanguage(language.code)}
                    className="flex items-center justify-between px-3 py-2.5 cursor-pointer text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{language.nativeName}</span>
                      <span className="text-xs text-white/40">{t(language.translationKey)}</span>
                    </div>
                    {i18n.language.split('-')[0] === language.code && (
                      <Check size={16} weight="bold" className="text-green-500" />
                    )}
                  </HoverMenuItem>
                ))}
              </HoverMenuContent>
            }
          >
            <button type="button" aria-label={t('dashboard.nav.open_language_menu')} className={footerIconClass}>
              <Globe size={18} weight="duotone" />
            </button>
          </HoverMenu>

          {/* My Organizations with hover menu (multi-org / SaaS only) */}
          {multiOrg && showOrgSwitcher && (
            <HoverMenu
              anchorRef={navRef}
              align="end"
                            content={
                <HoverMenuContent className="w-64 max-h-96 overflow-y-auto">
                  <HoverMenuLabel className="flex items-center gap-2 text-white/70 font-medium">
                    <Buildings size={16} weight="duotone" />
                    <span>{t('common.organizations', { defaultValue: 'Organizations' })}</span>
                  </HoverMenuLabel>
                  <HoverMenuSeparator />
                  {managesAnyOrg && (
                    <HoverMenuItem asChild>
                      <a href={getMainDomainUri('/home')} className={MENU_ITEM_CLASS}>
                        <House size={16} weight="duotone" />
                        <span>{t('common.home', { defaultValue: 'Home' })}</span>
                      </a>
                    </HoverMenuItem>
                  )}
                  {canManageOrg && (
                    <HoverMenuItem asChild>
                      <a href={getMainDomainUri(`/billing?org=${org?.slug ?? ''}`)} className={MENU_ITEM_CLASS}>
                        <CurrencyCircleDollar size={16} weight="duotone" />
                        <span>{t('common.billing', { defaultValue: 'Billing' })}</span>
                      </a>
                    </HoverMenuItem>
                  )}
                  {myOrgs.length > 0 && <HoverMenuSeparator />}
                  {myOrgs.map((o: any) => (
                    <HoverMenuItem key={o.id} asChild>
                      <a href={getUriWithOrg(o.slug, '/')} className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors",
                        o.id === org?.id ? "text-white" : "text-white/70"
                      )}>
                        <Buildings size={16} weight="duotone" />
                        <span className="truncate flex-1">{o.name}</span>
                        {o.id === org?.id && <Check size={14} weight="bold" className="text-green-500" />}
                      </a>
                    </HoverMenuItem>
                  ))}
                  {managesAnyOrg && (
                    <>
                      <HoverMenuSeparator />
                      <HoverMenuItem asChild>
                        <a href={getMainDomainUri('/new')} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors">
                          <Plus size={16} weight="bold" />
                          <span>{t('common.create_organization', { defaultValue: 'Create organization' })}</span>
                        </a>
                      </HoverMenuItem>
                    </>
                  )}
                </HoverMenuContent>
              }
            >
              <button type="button" aria-label={t('dashboard.nav.open_organizations_menu')} className={footerIconClass}>
                <Buildings size={18} weight="duotone" />
              </button>
            </HoverMenu>
          )}
        </div>
        {/* Which LearnHouse this is: quiet, one line, links to the release notes. */}
        {!isCollapsed && (
          <a
            href={lhVersion.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={lhVersion.buildFull ? `LearnHouse ${lhVersion.version} (${lhVersion.buildFull})` : `LearnHouse ${lhVersion.version}`}
            className={cn(
              "mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-4 text-white/30 hover:text-white/60 transition-colors tabular-nums",
              FOCUS_RING
            )}
          >
            <span className="font-medium">LearnHouse</span>
            <span className="truncate">{lhVersion.label}</span>
          </a>
        )}
      </div>
      </div>

      <SidebarResizeHandle navRef={navRef} prefs={sidebarPrefs} onDraggingChange={setResizing} />
    </nav>

      {/* Feedback Modal */}
      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="dark"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </TooltipProvider>
  )
}

/** A titled group of rows. Collapsed, the title becomes a short divider. */
function NavSection({ label, collapsed, children }: {
  label: string
  collapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-px">
      {collapsed ? (
        <div aria-hidden="true" className="mx-auto my-2 h-px w-6 bg-white/[0.08]" />
      ) : (
        <div aria-hidden="true" className="px-2.5 pt-4 pb-1 text-[11px] font-medium text-white/35 truncate select-none">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * One sidebar row. Rows with a flyout (`hasMenu`) show a small caret on
 * hover and skip the collapsed tooltip, since the flyout names them already.
 */
function NavRow({ href, icon: Icon, label, ariaLabel, collapsed, active = false, hasMenu, tooltipSide = 'right', onClick }: {
  href: string
  icon: PhosphorIcon
  label: string
  ariaLabel?: string
  collapsed: boolean
  active?: boolean
  hasMenu?: boolean
  tooltipSide?: 'left' | 'right'
  onClick?: () => void
}) {
  const link = (
    // Full prefetch: dashboard pages are dynamic, so the default would only
    // fetch the route shell and the click would still wait on the server.
    <Link
      href={href}
      prefetch
      aria-label={ariaLabel ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={rowClass(active, collapsed)}
    >
      <Icon size={18} weight="duotone" className="shrink-0" />
      {!collapsed && <span className="flex-1 min-w-0 truncate text-start">{label}</span>}
      {!collapsed && hasMenu && (
        <CaretRight
          aria-hidden="true"
          size={12}
          weight="bold"
          className="shrink-0 text-white/30 opacity-0 transition-opacity group-hover/row:opacity-100 rtl:rotate-180"
        />
      )}
    </Link>
  )

  if (!collapsed || hasMenu) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={tooltipSide} className={TOOLTIP_CLASS}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export default DashLeftMenu
