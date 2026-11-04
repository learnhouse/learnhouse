'use client'
import React, { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import Image from 'next/image'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { HeaderProfileBox } from '@components/Security/HeaderProfileBox'
import MenuLinks from './OrgMenuLinks'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { SearchTrigger } from '@components/Objects/Search/SearchTrigger'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import {
  Question,
  Book,
  Globe,
  ChatCircleDots,
  SquaresFour,
  ChalkboardSimple,
  Signpost,
  ChatsCircle,
  CalendarDots,
} from '@phosphor-icons/react'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { DASHBOARD_MENU_ITEMS, DashboardMenuItem } from '@/lib/dashboard-menu-items'
import { isFeatureAvailable } from '@services/plans/plans'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { useJoinBannerVisible, JOIN_BANNER_HEIGHT } from '@components/Objects/Banners/OrgJoinBanner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import { useShowLearnHouseBranding } from '@components/Hooks/useLearnHouseBranding'

// Only shows on demand (feedback button), so keep it out of every page's
// initial bundle.
const FeedbackModal = dynamic(
  () => import('@components/Objects/Modals/FeedbackModal').then((m) => m.FeedbackModal),
  { ssr: false }
)

export const OrgMenu = (props: any) => {
  const orgslug = props.orgslug
  const session = useLHSession() as any;
  const _access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any;
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const pathname = usePathname()
  const { t } = useTranslation()
  const { rights } = useAdminStatus()
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  // Mounted on first open and kept, so the close animation and draft survive.
  const [feedbackModalMounted, setFeedbackModalMounted] = useState(false)
  const { isVisible: isJoinBannerVisible } = useJoinBannerVisible()
  const { track } = useLHAnalytics()

  const messagingEnabled = useMessagingEnabled()
  const { unreadTotal } = useMessaging()


  const topOffset = isJoinBannerVisible ? JOIN_BANNER_HEIGHT : 0

  // Get primary color from org config (v2: customization.general.color, v1: general.color)
  const config = org?.config?.config
  const primaryColor = config?.customization?.general?.color || config?.general?.color || ''
  const colors = getMenuColorClasses(primaryColor)
  const showBranding = useShowLearnHouseBranding()

  // Filter dashboard menu items by resolved_features from API
  const rf = config?.resolved_features
  const visibleDashboardItems = DASHBOARD_MENU_ITEMS.filter((item: DashboardMenuItem) => {
    if (!item.featureKey) return true
    if (rf?.[item.featureKey]) return rf[item.featureKey].enabled
    return isFeatureAvailable(item.featureKey)
  })

  useEffect(() => {
    // Only check focus mode if we're in an activity page
    if (typeof window !== 'undefined' && pathname?.includes('/activity/')) {
      const saved = localStorage.getItem('globalFocusMode');
      setIsFocusMode(saved === 'true');
    } else {
      setIsFocusMode(false);
    }

    // Add storage event listener for cross-window changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'globalFocusMode' && pathname?.includes('/activity/')) {
        setIsFocusMode(e.newValue === 'true');
      }
    };

    // Add custom event listener for same-window changes
    const handleFocusModeChange = (e: CustomEvent) => {
      if (pathname?.includes('/activity/')) {
        setIsFocusMode(e.detail.isFocusMode);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focusModeChange', handleFocusModeChange as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focusModeChange', handleFocusModeChange as EventListener);
    };
  }, [pathname]);

  function toggleMenu() {
    setIsMenuOpen(!isMenuOpen)
  }

  // Only hide menu if we're in an activity page and focus mode is enabled
  if (pathname?.includes('/activity/') && isFocusMode) {
    return null;
  }

  return (
    <>
      <div className="backdrop-blur-lg h-[60px] blur-3xl" style={{ zIndex: 'var(--z-behind)', marginTop: topOffset }}></div>
      <nav
        aria-label={t('dashboard.nav.top_navigation')}
        className={`backdrop-blur-lg fixed start-0 end-0 h-[60px] ${!primaryColor ? 'bg-white/90 nice-shadow' : ''}`}
        style={{
          zIndex: 'var(--z-nav)',
          backgroundColor: primaryColor || undefined,
          top: topOffset
        }}
      >
        <div className="flex items-center justify-between w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 h-full">
          <div className="flex items-center space-x-5 md:w-auto w-full">
            <div className="logo flex shrink-0 md:w-auto w-full justify-center">
              <Link href={getUriWithOrg(orgslug, '/')} className="shrink-0">
                <div className="flex w-auto h-9 rounded-md items-center m-auto py-1 justify-center">
                  {org?.logo_image ? (
                    <img
                      src={`${getOrgLogoMediaDirectory(org.org_uuid, org?.logo_image)}`}
                      alt={org?.name || 'Logo'}
                      className="h-full w-auto max-w-[180px] shrink-0 object-contain rounded-md"
                    />
                  ) : showBranding ? (
                    <LearnHouseLogo logoFilter={colors.logoFilter} />
                  ) : (
                    <span className={`text-lg font-bold truncate max-w-[200px] ${colors.text}`}>{org?.name}</span>
                  )}
                </div>
              </Link>
            </div>
            <div className="hidden md:flex">
              <MenuLinks orgslug={orgslug} primaryColor={primaryColor} />
            </div>
          </div>

          {/* Search Section */}
          <div className="hidden md:flex flex-1 justify-center max-w-lg px-4">
            <SearchTrigger className="w-full" primaryColor={primaryColor} />
          </div>

          <div className="flex items-center space-x-2">
            {/* Progress / Trail */}
            <AuthenticatedClientElement checkMethod="authentication">
              <div className="hidden md:flex">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={getUriWithOrg(orgslug, '/trail')}
                        className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                        aria-label={t('courses.progress')}
                      >
                        <Signpost size={20} weight="fill" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="flex items-center gap-2 text-xs">
                      {t('courses.progress')}
                      <Keys keys="g t" />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </AuthenticatedClientElement>
            {/* Calendar */}
            <AuthenticatedClientElement checkMethod="authentication">
              <div className="hidden md:flex">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={getUriWithOrg(orgslug, '/calendar')}
                        className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                        aria-label={t('calendar.title')}
                      >
                        <CalendarDots size={20} weight="fill" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="flex items-center gap-2 text-xs">
                      {t('calendar.title')}
                      <Keys keys="g e" />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </AuthenticatedClientElement>
            {/* Boards */}
            {rf?.boards?.enabled && (
              <AuthenticatedClientElement checkMethod="authentication">
                <div className="hidden md:flex">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={getUriWithOrg(orgslug, '/boards')}
                          className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                          aria-label={t('common.boards')}
                        >
                          <ChalkboardSimple size={20} weight="fill" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="flex items-center gap-2 text-xs">
                        {t('common.boards')}
                        <Keys keys="g b" />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </AuthenticatedClientElement>
            )}
            {/* Messages */}
            {messagingEnabled && (
              <AuthenticatedClientElement checkMethod="authentication">
                <div className="hidden md:flex">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={getUriWithOrg(orgslug, '/messages')}
                          className={`relative p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                          aria-label={unreadTotal ? `Messages, ${unreadTotal} unread` : 'Messages'}
                        >
                          <ChatsCircle size={20} weight="fill" />
                          {unreadTotal > 0 && (
                            <span className="absolute top-0.5 end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center ring-2 ring-white tabular-nums">
                              {unreadTotal > 99 ? '99+' : unreadTotal}
                            </span>
                          )}
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Messages
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </AuthenticatedClientElement>
            )}
            {/* Dashboard Dropdown - Only visible to admins */}
            {session?.status === 'authenticated' && rights?.dashboard?.action_access && (
              <div className="hidden md:flex">
                <DropdownMenu>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                            aria-label={t('common.dashboard')}
                          >
                            <SquaresFour size={20} weight="fill" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {t('common.dashboard')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="flex items-center gap-2">
                      <SquaresFour size={16} weight="fill" />
                      <span>{t('common.dashboard')}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {visibleDashboardItems.map((item) => {
                      const IconComponent = item.icon
                      return (
                        <DropdownMenuItem key={item.id} asChild>
                          <Link
                            href={item.href}
                            className="flex items-center gap-2"
                            onClick={() => track(AnalyticsEvent.DashboardEntered, { source: 'org_menu' })}
                          >
                            <IconComponent size={16} weight="fill" />
                            <span>{t(item.labelKey)}</span>
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Help Dropdown - Only visible to admins/maintainers/instructors */}
            {session?.status === 'authenticated' && rights?.dashboard?.action_access && (
              <div className="hidden md:flex">
                <DropdownMenu>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                            aria-label={t('common.help')}
                          >
                            <Question size={20} weight="fill" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {t('common.help')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="flex items-center gap-2">
                      <Question size={16} weight="fill" />
                      <span>{t('common.help')}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a
                        href="https://docs.learnhouse.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2"
                      >
                        <Book size={16} weight="fill" />
                        <span>{t('common.help_menu.documentation')}</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href="https://learnhouse.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2"
                      >
                        <Globe size={16} weight="fill" />
                        <span>{t('common.help_menu.website')}</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href="http://learnhouse.to/discord"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2"
                      >
                        <DiscordIcon size={16} />
                        <span>{t('common.help_menu.discord')}</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setFeedbackModalMounted(true)
                        setFeedbackModalOpen(true)
                      }}
                      className="flex items-center gap-2"
                    >
                      <ChatCircleDots size={16} weight="fill" />
                      <span>{t('common.help_menu.report_feedback')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            <div className="hidden md:flex">
              <HeaderProfileBox primaryColor={primaryColor} />
            </div>
            <button
              className={`md:hidden focus:outline-hidden ${colors.text}`}
              onClick={toggleMenu}
            >
              {isMenuOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </nav>
      <div
        className={`fixed inset-x-0 bg-white/80 backdrop-blur-lg md:hidden shadow-lg transition-all duration-300 ease-in-out ${
          isMenuOpen ? 'opacity-100' : '-top-full opacity-0'
        }`}
        style={{
          zIndex: 'var(--z-nav-menu)',
          top: isMenuOpen ? topOffset + 60 : undefined
        }}
      >
        <div className="flex flex-col px-4 py-3 space-y-4 justify-center items-center">
          {/* Mobile Search */}
          <div className="w-full px-2">
            <SearchTrigger isMobile />
          </div>
          <div className='py-4'>
            <MenuLinks orgslug={orgslug} />
          </div>
          {messagingEnabled && session?.status === 'authenticated' && (
            <Link
              href={getUriWithOrg(orgslug, '/messages')}
              onClick={() => setIsMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-neutral-800 bg-neutral-100"
            >
              <ChatsCircle size={18} weight="fill" />
              Messages
              {unreadTotal > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center tabular-nums">
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              )}
            </Link>
          )}
          <div className="border-t border-gray-200">
            <HeaderProfileBox />
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      {feedbackModalMounted && (
        <FeedbackModal
          open={feedbackModalOpen}
          onOpenChange={setFeedbackModalOpen}
          theme="light"
          userName={session?.data?.user?.username}
          userEmail={session?.data?.user?.email}
        />
      )}

    </>
  )
}

const LearnHouseLogo = ({ logoFilter }: { logoFilter: string }) => {
  return (
    <Image
      src="/lrn-text.svg"
      alt="LearnHouse logo"
      width={133}
      height={40}
      style={{ height: 'auto', filter: logoFilter }}
    />
  )
}
