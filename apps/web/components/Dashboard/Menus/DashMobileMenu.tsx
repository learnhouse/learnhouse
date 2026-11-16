'use client'
import { createPortal } from 'react-dom'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from '@components/Contexts/AuthContext'
import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  Globe,
  Moon,
  Sun,
  Gear,
  SignOut,
  Headphones,
  VideoCamera,
  ChartBar,
  ChalkboardSimple,
  Lightning,
  FolderSimple,
  Circuitry,
  Check,
  ChatCircleDots,
  Book,
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  Code,
  DotsNine,
  Garage,
  Newspaper,
  SealCheck,
} from '@phosphor-icons/react'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import { useUnreadCount } from '@components/Notifications/useUnreadCount'
import { Bell as BellIcon } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg, getDeploymentMode } from '@services/config/config'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/lib/i18n'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import OrgSquareLogo, { hasOrgLogo, OrgInitial } from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { planMeetsRequirement } from '@services/plans/plans'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useCommandPalette } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { useDashNavPrefetch } from '@components/Dashboard/Shared/useDashNavPrefetch'

/**
 * Dashboard navigation below lg: a dark bottom tab bar (the desktop sidebar's
 * colours) with the four places admins live in, and every other section in a
 * "More" sheet (a bottom sheet on phones, via the shared Dialog).
 */
function DashMobileMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const { colorScheme, toggleColorScheme } = useColorScheme()
  const pathname = usePathname() || ''
  const plan = usePlan()
  const { toggle: openSearch } = useCommandPalette()
  const [moreOpen, setMoreOpen] = useState(false)
  const adminUnread = useUnreadCount('admin')
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [langExpanded, setLangExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  // Touch/focus on any link warms its page and data before the tap lands.
  const navPrefetch = useDashNavPrefetch()

  useEffect(() => { setMounted(true) }, [])

  // Publish the bar's height (styles/mobile-dashboard.css) so pages, toasts
  // and sticky footers can sit above it.
  useEffect(() => {
    document.documentElement.classList.add('lh-has-dash-tabbar')
    return () => document.documentElement.classList.remove('lh-has-dash-tabbar')
  }, [])

  if (!org || !session || !mounted) return null

  const mode = getDeploymentMode()
  const planLabel =
    mode === 'ee' ? t('dashboard.nav.enterprise_edition') :
    mode === 'oss' ? 'OSS' :
    plan

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (f: string) => rf?.[f]?.enabled === true

  const isActive = (path: string) => {
    if (path === '/dash') return pathname === '/dash' || pathname === '/dash/'
    return pathname === path || pathname.startsWith(path + '/')
  }

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }

  const close = () => { setMoreOpen(false); setLangExpanded(false) }

  const tabs = [
    { key: 'home', href: '/dash', Icon: House, label: t('common.home'), active: isActive('/dash') },
    { key: 'courses', href: '/dash/courses', Icon: BookOpen, label: t('courses.courses'), active: isActive('/dash/courses') },
    { key: 'assignments', href: '/dash/assignments', Icon: Files, label: t('common.assignments'), active: isActive('/dash/assignments') },
    { key: 'users', href: '/dash/users/settings/users', Icon: Users, label: t('common.users'), active: isActive('/dash/users') },
  ]

  // Everything that isn't a tab, as a grid of large targets in the sheet.
  const sections = [
    { href: '/dash/website', Icon: Globe, label: t('website.title'), match: '/dash/website' },
    isEnabled('paths') && { href: '/dash/paths', Icon: Circuitry, label: t('paths.title') },
    isEnabled('folders') && { href: '/dash/library', Icon: FolderSimple, label: t('library.library') },
    isEnabled('communities') && { href: '/dash/communities', Icon: Garage, label: t('communities.title') },
    isEnabled('podcasts') && { href: '/dash/podcasts', Icon: Headphones, label: t('podcasts.podcasts') },
    isEnabled('live_sessions') && { href: '/dash/live-sessions', Icon: VideoCamera, label: t('live_sessions.title') },
    isEnabled('boards') && { href: '/dash/boards', Icon: ChalkboardSimple, label: t('common.boards') },
    isEnabled('newsletter') && { href: '/dash/newsletter/overview', Icon: Newspaper, label: t('newsletter.common.title'), match: '/dash/newsletter' },
    isEnabled('playgrounds') && { href: '/dash/playgrounds', Icon: Lightning, label: t('common.playgrounds') },
    isEnabled('payments') && { href: '/dash/payments/overview', Icon: CurrencyCircleDollar, label: t('common.payments') },
    isEnabled('required_training') && { href: '/dash/training/compliance', Icon: SealCheck, label: t('hr.training.nav'), match: '/dash/training' },
    isOrgAnalyticsAvailable() && { href: '/dash/analytics', Icon: ChartBar, label: t('common.analytics') },
    { href: '/dash/org/settings/overview', Icon: Buildings, label: t('common.organization'), match: '/dash/org' },
    { href: '/dash/developers', Icon: Code, label: t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' }), match: '/dash/developers' },
  ].filter(Boolean) as { href: string; Icon: any; label: string; match?: string }[]

  const moreActive = moreOpen || sections.some((s) => isActive(s.match ?? s.href))

  return createPortal(
    <>
      <nav
        {...navPrefetch}
        aria-label={t('dashboard.nav.mobile_navigation')}
        data-duotone="strong"
        className="lh-dash-tabbar lh-bottom-bleed fixed inset-x-0 bottom-0 bg-[#0f0f10]/95 backdrop-blur-xl backdrop-saturate-150 border-t border-white/[0.08]"
        style={{ zIndex: 'var(--z-nav)', paddingBottom: 'var(--lh-safe-bottom)' }}
      >
        <ul className="flex items-stretch justify-around max-w-xl mx-auto" style={{ height: 'var(--lh-tabbar-h)' }}>
          {tabs.map(({ key, href, Icon, label, active }) => (
            <li key={key} className="flex flex-1 min-w-0">
              <Link
                href={href}
                prefetch
                aria-current={active ? 'page' : undefined}
                className={cn('lh-press flex flex-1 min-w-0 select-none', active ? 'text-white' : 'text-white/45')}
              >
                <TabInner Icon={Icon} label={label} active={active} />
              </Link>
            </li>
          ))}
          <li className="flex flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label={t('common.more')}
              aria-expanded={moreOpen}
              className={cn('lh-press flex flex-1 min-w-0 select-none', moreActive ? 'text-white' : 'text-white/45')}
            >
              <span className="relative flex flex-1 min-w-0">
                <TabInner Icon={DotsNine} label={t('common.more')} active={moreActive} />
                {adminUnread > 0 && <span aria-hidden className="absolute top-2 start-1/2 ms-3 size-2 rounded-full bg-red-500 ring-2 ring-[#0f0f10]" />}
              </span>
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={moreOpen} onOpenChange={(o) => { if (!o) close(); else setMoreOpen(true) }}>
        <DialogContent className="lh-dash-sheet flex flex-col p-0 bg-[#0f0f10] border-white/[0.08] text-white max-h-[85dvh] [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">{t('common.more')}</DialogTitle>
          <div className="flex-1 overflow-y-auto overscroll-contain pt-3 pb-4 space-y-4">
            {/* Org */}
            <div className="flex items-center gap-3 px-4">
              {(planMeetsRequirement(plan, 'standard') && hasOrgLogo(org)) || isWhiteLabelPlan(plan) ? (
                <div className="h-10 w-10 rounded-xl overflow-hidden bg-white shrink-0">
                  <OrgSquareLogo org={org} wideInsetClassName="p-0.5" fallback={isWhiteLabelPlan(plan) ? <OrgInitial org={org} className="text-sm" /> : <img src="/lrn.svg" alt="LearnHouse" className="w-full h-full object-contain p-1" />} />
                </div>
              ) : (
                <div className="h-10 w-10 flex items-center justify-center bg-white/[0.06] rounded-xl shrink-0">
                  <img src="/lrn-dash.svg" alt="LearnHouse" className="h-5 w-5" style={{ filter: 'brightness(0) invert(1)' }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white truncate leading-tight">{org?.name}</p>
                <p className={cn(
                  'text-xs font-medium',
                  mode === 'ee' ? 'text-amber-400' :
                  mode === 'oss' ? 'text-green-400' :
                  plan === 'enterprise' ? 'text-amber-400' :
                  plan === 'pro' ? 'text-purple-400' :
                  plan === 'standard' ? 'text-blue-400' :
                  'text-white/40'
                )}>{planLabel}</p>
              </div>
            </div>

            {/* Search, styled as the field it opens */}
            <div className="px-4">
              <button
                type="button"
                onClick={() => { close(); openSearch() }}
                className="lh-press flex items-center gap-2.5 w-full h-11 px-3.5 rounded-xl bg-white/[0.07] text-white/50 text-[15px]"
              >
                <MagnifyingGlass size={18} weight="bold" />
                <span>{t('common.search')}</span>
              </button>
            </div>

            {/* Sections */}
            <div className="grid grid-cols-3 gap-2 px-4">
              {sections.map(({ href, Icon, label, match }) => {
                const active = isActive(match ?? href)
                return (
                  <Link
                    key={href}
                    href={href}
                    prefetch
                    onTouchStart={navPrefetch.onTouchStart}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'lh-press flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-1.5 py-2.5 rounded-2xl text-center transition-colors',
                      active ? 'bg-white text-[#0f0f10]' : 'bg-white/[0.06] text-white/80 active:bg-white/[0.1]'
                    )}
                  >
                    <Icon size={22} weight="duotone" />
                    <span className="text-xs font-medium leading-tight line-clamp-2 break-words">{label}</span>
                  </Link>
                )
              })}
            </div>

            {/* Account and help */}
            <div className="mx-4 rounded-2xl bg-white/[0.04] divide-y divide-white/[0.06] overflow-hidden">
              <SheetRow
                href="/dash/notifications"
                Icon={BellIcon}
                label={t('notifications.admin_title')}
                onClick={close}
                trailing={adminUnread > 0 ? (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center tabular-nums">
                    {adminUnread > 99 ? '99+' : adminUnread}
                  </span>
                ) : undefined}
              />
              <SheetRow href="/account/general" Icon={Gear} label={t('common.settings')} onClick={close} />
              <SheetRow
                Icon={colorScheme === 'dark' ? Sun : Moon}
                label={colorScheme === 'dark' ? t('common.switch_to_light') : t('common.switch_to_dark')}
                onClick={toggleColorScheme}
              />
              <SheetRow
                Icon={Globe}
                label={t('common.language')}
                onClick={() => setLangExpanded(v => !v)}
                trailing={<CaretDown size={12} weight="bold" className={cn('text-white/30 transition-transform', langExpanded && 'rotate-180')} />}
              />
              {langExpanded && (
                <div className="py-1">
                  {AVAILABLE_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => { changeLanguage(lang.code); setLangExpanded(false) }}
                      className="flex items-center justify-between w-full ps-14 pe-4 min-h-[44px] text-[15px] text-white/70 active:bg-white/[0.06]"
                    >
                      <span className="font-medium">{lang.nativeName}</span>
                      {i18n.language.split('-')[0] === lang.code && <Check size={14} weight="bold" className="text-green-500" />}
                    </button>
                  ))}
                </div>
              )}
              <SheetRow href="https://docs.learnhouse.app" external Icon={Book} label={t('common.help_menu.documentation')} />
              <SheetRow href="http://learnhouse.to/discord" external Icon={DiscordIcon} label={t('common.help_menu.discord')} />
              <SheetRow
                Icon={ChatCircleDots}
                label={t('common.help_menu.report_feedback')}
                onClick={() => { close(); setFeedbackModalOpen(true) }}
              />
            </div>

            {/* User */}
            <div className="mx-4 flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
              <UserAvatar width={40} rounded="rounded-full" shadow="shadow-none" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-white truncate leading-tight">{session?.data?.user?.username}</p>
                <p className="text-xs text-white/40 truncate">{session?.data?.user?.email}</p>
              </div>
              <button
                type="button"
                onClick={logOutUI}
                aria-label={t('user.sign_out')}
                className="lh-press flex items-center justify-center h-10 w-10 rounded-xl text-white/50 bg-white/[0.06] active:text-red-400"
              >
                <SignOut size={18} weight="duotone" data-dir-flip />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="dark"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>,
    document.body
  )
}

const TabInner = ({ Icon, label, active }: { Icon: any; label: string; active: boolean }) => (
  <span className="flex flex-col items-center justify-center gap-[3px] h-full w-full">
    <span className={cn('flex items-center justify-center h-7 w-12 rounded-full transition-colors', active && 'bg-white/[0.12]')}>
      <Icon size={22} weight="duotone" />
    </span>
    <span className={cn('text-[10.5px] leading-none tracking-tight truncate max-w-[72px]', active ? 'font-semibold' : 'font-medium')}>
      {label}
    </span>
  </span>
)

const SheetRow = ({
  href,
  external,
  onClick,
  Icon,
  label,
  trailing,
}: {
  href?: string
  external?: boolean
  onClick?: () => void
  Icon: any
  label: string
  trailing?: React.ReactNode
}) => {
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/70">
        <Icon size={17} weight="duotone" />
      </span>
      <span className="flex-1 truncate text-[15px] font-medium text-white/85">{label}</span>
      {trailing ?? <CaretRight size={12} weight="bold" className="text-white/25 rtl:rotate-180" />}
    </>
  )
  const cls = 'lh-press flex w-full items-center gap-3 px-3 min-h-[52px] text-start active:bg-white/[0.04]'
  if (href && external) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
  }
  if (href) {
    return <Link href={href} onClick={onClick} className={cls}>{body}</Link>
  }
  return <button type="button" onClick={onClick} className={cls}>{body}</button>
}

export default DashMobileMenu
