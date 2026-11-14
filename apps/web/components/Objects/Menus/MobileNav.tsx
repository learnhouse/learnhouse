'use client'
import React, { useEffect, useState } from 'react'
import { useDashNavPrefetch } from '@components/Dashboard/Shared/useDashNavPrefetch'
import { isClientRenderedLearnerRoute } from '@/lib/query/learnerQueries'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  House,
  Books,
  MagnifyingGlass,
  HouseSimple,
  DotsNine,
  SignIn,
  CalendarDots,
  ChatsCircle,
  User,
  ShoppingBag,
  Globe,
  Moon,
  Sun,
  Book,
  SignOut,
  CaretRight,
  Check,
  SquaresFour,
  UsersThree,
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import UserAvatar from '@components/Objects/UserAvatar'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from '@components/Contexts/AuthContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { useSiteCommandPalette } from '@components/Objects/Search/SiteCommandPaletteContext'
import { getUriWithOrg } from '@services/config/config'
import { isFeatureAvailable } from '@services/plans/plans'
import { changeLanguage } from '@/lib/i18n'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import { DASHBOARD_MENU_ITEMS, DashboardMenuItem } from '@/lib/dashboard-menu-items'
import { useMenuGroups } from '@components/Pages/Groups/GroupMenuItems'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useOrgMenuItems } from './OrgMenuLinks'

/** Fired by the header avatar to open the More sheet from outside the tab bar. */
export const OPEN_MOBILE_MORE_EVENT = 'lh:open-mobile-more'

/**
 * Pages that draw their own bottom chrome (the course reader's activity bar,
 * full-bleed chat) or need every pixel (live rooms). The tab bar steps aside.
 */
function hidesTabBar(pathname: string) {
  return (
    pathname.includes('/activity/') ||
    pathname.includes('/messages') ||
    /\/live\/[^/]+\/room/.test(pathname)
  )
}

/** Strip the org prefix proxy routing may leave on the path, so /orgs/x/courses and /courses compare equal. */
function pagePath(pathname: string) {
  return pathname.replace(/^\/orgs\/[^/]+/, '') || '/'
}

function isActive(path: string, href: string) {
  const target = pagePath(new URL(href, 'http://x').pathname)
  if (target === '/') return path === '/'
  return path === target || path.startsWith(target + '/') ||
    // A course or path page belongs to its catalog tab.
    (target === '/courses' && path.startsWith('/course/')) ||
    (target === '/paths' && path.startsWith('/path/'))
}

/**
 * Phone and tablet navigation: a bottom tab bar in the iOS/Android idiom, with
 * the rest of the org menu, the account and admin entries in a "More" sheet.
 * Desktop keeps the header links; this renders nothing from lg up.
 */
export function MobileTabBar({ orgslug, primaryColor = '' }: { orgslug: string; primaryColor?: string }) {
  const { t } = useTranslation()
  const pathname = usePathname() || '/'
  const session = useLHSession() as any
  const { setOpen: openSearch } = useSiteCommandPalette()
  const menuItems = useOrgMenuItems(orgslug)
  const [moreOpen, setMoreOpen] = useState(false)
  // A touch on a tab warms its page (and the data it reads first).
  const navPrefetch = useDashNavPrefetch('learner')
  const path = pagePath(pathname)
  const hidden = hidesTabBar(pathname)
  const isAuthenticated = session?.status === 'authenticated'

  // Publish the bar's height to the page (styles/mobile.css) while it shows.
  useEffect(() => {
    if (hidden) return
    document.documentElement.classList.add('lh-has-tabbar')
    return () => document.documentElement.classList.remove('lh-has-tabbar')
  }, [hidden])

  useEffect(() => {
    const open = () => setMoreOpen(true)
    window.addEventListener(OPEN_MOBILE_MORE_EVENT, open)
    return () => window.removeEventListener(OPEN_MOBILE_MORE_EVENT, open)
  }, [])

  // Close the sheet whenever a link in it navigates (adjusting state during
  // render, React's recommended alternative to an effect for this).
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setMoreOpen(false)
  }

  // Second tab is the org's own first section (usually Courses).
  const primary = menuItems.find((i) => !i.external) ?? null
  const sheet = (
    <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} orgslug={orgslug} skipKey={hidden ? undefined : primary?.key} />
  )

  // The header avatar can still open the sheet where the bar steps aside.
  if (hidden) return sheet

  // --lhd-ink only exists in dark mode (styles/dark.css).
  const accent = primaryColor || 'var(--lhd-ink, #0a0a0a)'

  const tabs: { key: string; label: string; Icon: any; href?: string; onClick?: () => void; active: boolean }[] = [
    { key: 'home', label: t('common.home'), Icon: House, href: getUriWithOrg(orgslug, '/'), active: path === '/' },
    ...(primary
      ? [{ key: primary.key, label: primary.label, Icon: primary.Icon ?? Books, href: primary.href, active: isActive(path, primary.href) }]
      : []),
    { key: 'search', label: t('common.search'), Icon: MagnifyingGlass, onClick: () => openSearch(true), active: path.startsWith('/search') },
    isAuthenticated
      ? { key: 'trail', label: t('courses.progress'), Icon: HouseSimple, href: getUriWithOrg(orgslug, '/trail'), active: path.startsWith('/trail') }
      : { key: 'login', label: t('auth.login'), Icon: SignIn, href: getUriWithOrg(orgslug, '/login'), active: path.startsWith('/login') },
    { key: 'more', label: t('common.more'), Icon: DotsNine, onClick: () => setMoreOpen(true), active: moreOpen },
  ]

  return (
    <>
      <nav
        {...navPrefetch}
        aria-label={t('mobile_nav.tabs', { defaultValue: 'Main' })}
        className="lh-bottom-bleed lg:hidden fixed inset-x-0 bottom-0 border-t border-black/[0.06] bg-white/85 backdrop-blur-xl backdrop-saturate-150"
        style={{ zIndex: 'var(--z-nav)', paddingBottom: 'var(--lh-safe-bottom)' }}
      >
        <ul className="flex items-stretch justify-around" style={{ height: 'var(--lh-tabbar-h)' }}>
          {tabs.map(({ key, label, Icon, href, onClick, active }) => {
            const inner = (
              <span className="flex flex-col items-center justify-center gap-[3px] h-full w-full">
                <Icon size={24} weight={active ? 'fill' : 'regular'} />
                <span className={`text-[10.5px] leading-none tracking-tight truncate max-w-[72px] ${active ? 'font-semibold' : 'font-medium'}`}>
                  {label}
                </span>
              </span>
            )
            const cls = `lh-press flex flex-1 min-w-0 select-none ${active ? '' : 'text-neutral-400'}`
            const style = active ? { color: accent } : undefined
            return (
              <li key={key} className="flex flex-1 min-w-0">
                {href ? (
                  <Link href={href} prefetch={isClientRenderedLearnerRoute(href) ? true : undefined} className={cls} style={style} aria-current={active ? 'page' : undefined}>
                    {inner}
                  </Link>
                ) : (
                  <button type="button" onClick={onClick} className={cls} style={style} aria-label={label}>
                    {inner}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      {sheet}
    </>
  )
}

function SheetGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h3 className="px-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>
      )}
      <div className="mx-3 overflow-hidden rounded-2xl bg-neutral-50 ring-1 ring-black/[0.04] divide-y divide-black/[0.05]">
        {children}
      </div>
    </section>
  )
}

function SheetRow({
  href,
  external,
  onClick,
  Icon,
  label,
  trailing,
  tone = 'default',
}: {
  href?: string
  external?: boolean
  onClick?: () => void
  Icon: any
  label: string
  trailing?: React.ReactNode
  tone?: 'default' | 'danger'
}) {
  const body = (
    <>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-white text-neutral-700 ring-1 ring-black/[0.05]'
        }`}
      >
        <Icon size={18} weight="fill" data-dir-flip={tone === 'danger' ? true : undefined} />
      </span>
      <span className={`flex-1 truncate text-[15px] font-medium ${tone === 'danger' ? 'text-red-600' : 'text-neutral-900'}`}>
        {label}
      </span>
      {trailing ?? (tone === 'default' && <CaretRight size={14} weight="bold" className="text-neutral-300 rtl:rotate-180" />)}
    </>
  )
  const cls = 'lh-press flex w-full items-center gap-3 px-3 min-h-[52px] text-start active:bg-black/[0.03]'
  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    )
  }
  if (href) {
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  )
}

function MobileMoreSheet({
  open,
  onOpenChange,
  orgslug,
  skipKey,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  orgslug: string
  skipKey?: string
}) {
  const { t, i18n } = useTranslation()
  const { colorScheme, toggleColorScheme } = useColorScheme()
  const menuGroups = useMenuGroups()
  const session = useLHSession() as any
  const org = useOrg() as any
  const { rights } = useAdminStatus()
  const { track } = useLHAnalytics()
  const messagingEnabled = useMessagingEnabled()
  const { unreadTotal } = useMessaging()
  const menuItems = useOrgMenuItems(orgslug).filter((i) => i.key !== skipKey)
  const [showLanguages, setShowLanguages] = useState(false)

  const isAuthenticated = session?.status === 'authenticated'
  const user = session?.data?.user
  const config = org?.config?.config
  const rf = config?.resolved_features
  const isAdmin = isAuthenticated && rights?.dashboard?.action_access
  const dashboardItems = DASHBOARD_MENU_ITEMS.filter((item: DashboardMenuItem) => {
    if (item.available && !item.available()) return false
    if (!item.featureKey) return true
    if (rf?.[item.featureKey]) return rf[item.featureKey].enabled
    return isFeatureAvailable(item.featureKey)
  })
  const currentLang = i18n.language.split('-')[0]

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setShowLanguages(false) }}>
      <DialogContent className="lg:hidden flex flex-col p-0 bg-white md:max-h-[85vh] md:w-[420px] [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{t('common.more')}</DialogTitle>
        <div className="flex-1 overflow-y-auto overscroll-contain pt-7 pb-4 space-y-5">
          {/* Who's signed in */}
          {isAuthenticated ? (
            <Link
              href={getUriWithOrg(orgslug, `/user/${user?.username}`)}
              className="lh-press mx-3 flex items-center gap-3 rounded-2xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]"
            >
              <UserAvatar border="border-2" rounded="rounded-full" width={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-neutral-900">
                  {user?.first_name || user?.last_name
                    ? `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()
                    : user?.username}
                </p>
                <p className="truncate text-sm text-neutral-500">{user?.email}</p>
              </div>
              <CaretRight size={14} weight="bold" className="text-neutral-300 rtl:rotate-180" />
            </Link>
          ) : (
            <div className="mx-3 grid grid-cols-2 gap-2">
              <Link
                href={getUriWithOrg(orgslug, '/login')}
                className="lh-press flex h-12 items-center justify-center rounded-xl bg-neutral-100 text-[15px] font-semibold text-neutral-900"
              >
                {t('auth.login')}
              </Link>
              <Link
                href={getUriWithOrg(orgslug, '/signup')}
                className="lh-press flex h-12 items-center justify-center rounded-xl bg-neutral-900 text-[15px] font-semibold text-white"
              >
                {t('auth.sign_up')}
              </Link>
            </div>
          )}

          {menuItems.length > 0 && (
            <SheetGroup title={t('mobile_nav.explore', { defaultValue: 'Explore' })}>
              {menuItems.map((it) => (
                <SheetRow key={it.key} href={it.href} external={it.external} Icon={it.Icon} label={it.label} />
              ))}
            </SheetGroup>
          )}

          {isAuthenticated && (
            <SheetGroup title={t('mobile_nav.you', { defaultValue: 'You' })}>
              {messagingEnabled && (
                <SheetRow
                  href={getUriWithOrg(orgslug, '/messages')}
                  Icon={ChatsCircle}
                  label={t('mobile_nav.messages', { defaultValue: 'Messages' })}
                  trailing={
                    unreadTotal > 0 ? (
                      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-xs font-bold leading-[22px] text-center tabular-nums">
                        {unreadTotal > 99 ? '99+' : unreadTotal}
                      </span>
                    ) : undefined
                  }
                />
              )}
              <SheetRow href={getUriWithOrg(orgslug, '/calendar')} Icon={CalendarDots} label={t('calendar.title')} />
              {menuGroups.any && <SheetRow href={getUriWithOrg(orgslug, '/groups')} Icon={UsersThree} label={t('groups.menu.title')} />}
              <SheetRow href={getUriWithOrg(orgslug, '/account/purchases')} Icon={ShoppingBag} label={t('account.purchases')} />
              <SheetRow href={getUriWithOrg(orgslug, '/account/general')} Icon={User} label={t('user.user_settings')} />
            </SheetGroup>
          )}

          {isAdmin && (
            <SheetGroup title={t('common.dashboard')}>
              {dashboardItems.map((item) => (
                <SheetRow
                  key={item.id}
                  href={item.href}
                  Icon={item.id === 'home' ? SquaresFour : item.icon}
                  label={item.id === 'home' ? t('common.dashboard') : t(item.labelKey)}
                  onClick={() => track(AnalyticsEvent.DashboardEntered, { source: 'mobile_more_sheet' })}
                />
              ))}
            </SheetGroup>
          )}

          <SheetGroup>
            <SheetRow
              onClick={toggleColorScheme}
              Icon={colorScheme === 'dark' ? Sun : Moon}
              label={colorScheme === 'dark' ? t('common.switch_to_light') : t('common.switch_to_dark')}
            />
            <SheetRow
              onClick={() => setShowLanguages((v) => !v)}
              Icon={Globe}
              label={t('common.language')}
              trailing={
                <span className="text-sm font-medium text-neutral-400 uppercase">{currentLang}</span>
              }
            />
            {showLanguages &&
              AVAILABLE_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => changeLanguage(language.code)}
                  className="flex w-full items-center justify-between ps-14 pe-4 min-h-[44px] text-start text-[15px] text-neutral-700 active:bg-black/[0.03]"
                >
                  <span>{language.nativeName}</span>
                  {currentLang === language.code && <Check size={16} weight="bold" className="text-neutral-900" />}
                </button>
              ))}
            {isAdmin && (
              <SheetRow href="https://docs.learnhouse.app" external Icon={Book} label={t('common.help_menu.documentation')} />
            )}
            {isAuthenticated && (
              <SheetRow
                onClick={() => {
                  track(AnalyticsEvent.LogoutClicked, { source: 'mobile_more_sheet' })
                  signOut({ callbackUrl: '/' })
                }}
                Icon={SignOut}
                label={t('common.sign_out')}
                tone="danger"
              />
            )}
          </SheetGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
