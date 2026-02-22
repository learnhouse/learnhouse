'use client'
import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import useSWR from 'swr'
import { getUriWithOrg } from '@services/config/config'
import { fetchRAGChatSessions, RAGChatSession } from '@services/ai/ai'
import { HeaderProfileBox } from '@components/Security/HeaderProfileBox'
import MenuLinks from './OrgMenuLinks'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { SearchBar } from '@components/Objects/Search/SearchBar'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import {
  Question,
  Book,
  Globe,
  ChatCircleDots,
  ChatCircle,
  SquaresFour,
  ChalkboardSimple,
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
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { DASHBOARD_MENU_ITEMS, DashboardMenuItem } from '@/lib/dashboard-menu-items'
import { isFeatureAvailable, planMeetsRequirement, PlanLevel } from '@services/plans/plans'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { useJoinBannerVisible, JOIN_BANNER_HEIGHT } from '@components/Objects/Banners/OrgJoinBanner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'

export const OrgMenu = (props: any) => {
  const orgslug = props.orgslug
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any;
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const pathname = usePathname()
  const { t } = useTranslation()
  const { rights } = useAdminStatus()
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const { isVisible: isJoinBannerVisible } = useJoinBannerVisible()
  const topOffset = isJoinBannerVisible ? JOIN_BANNER_HEIGHT : 0

  // Get primary color from org config
  const primaryColor = org?.config?.config?.general?.color || ''
  const colors = getMenuColorClasses(primaryColor)
  const plan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  // Filter dashboard menu items by feature enabled + plan availability
  const visibleDashboardItems = DASHBOARD_MENU_ITEMS.filter((item: DashboardMenuItem) => {
    if (!item.featureKey) return true
    const featureConfig = org?.config?.config?.features?.[item.featureKey]
    const isEnabled = item.defaultDisabled ? featureConfig?.enabled === true : featureConfig?.enabled !== false
    return isEnabled && isFeatureAvailable(item.featureKey, plan)
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
      <div
        className={`backdrop-blur-lg fixed left-0 right-0 h-[60px] ${!primaryColor ? 'bg-white/90 nice-shadow' : ''}`}
        style={{
          zIndex: 'var(--z-nav)',
          backgroundColor: primaryColor || undefined,
          top: topOffset
        }}
      >
        <div className="flex items-center justify-between w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 h-full">
          <div className="flex items-center space-x-5 md:w-auto w-full">
            <div className="logo flex md:w-auto w-full justify-center">
              <Link href={getUriWithOrg(orgslug, '/')}>
                <div className="flex w-auto h-9 rounded-md items-center m-auto py-1 justify-center">
                  {org?.logo_image ? (
                    <img
                      src={`${getOrgLogoMediaDirectory(org.org_uuid, org?.logo_image)}`}
                      alt="Learnhouse"
                      style={{ width: 'auto', height: '100%' }}
                      className="rounded-md"
                    />
                  ) : (
                    <LearnHouseLogo logoFilter={colors.logoFilter} />
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
            <SearchBar orgslug={orgslug} className="w-full" primaryColor={primaryColor} />
          </div>

          <div className="flex items-center space-x-2">
            {/* Boards (Pro+ or OSS only, authenticated users only) */}
            {org?.config?.config?.features?.boards?.enabled === true && planMeetsRequirement(org?.config?.config?.cloud?.plan || 'free', 'pro') && (
              <AuthenticatedClientElement checkMethod="authentication">
                <div className="hidden md:flex">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={getUriWithOrg(orgslug, '/boards')}
                          className={`p-2 rounded-lg transition-colors ${colors.iconBtn}`}
                          aria-label="Boards"
                        >
                          <ChalkboardSimple size={20} weight="fill" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Boards
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </AuthenticatedClientElement>
            )}
            {/* AI Copilot */}
            {org?.config?.config?.features?.ai?.enabled !== false && org?.config?.config?.features?.ai?.copilot_enabled !== false && (
              <AuthenticatedClientElement checkMethod="authentication">
                <div className="hidden md:flex">
                  <CopilotMenuButton orgslug={orgslug} iconBtnClass={colors.iconBtn} />
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
                          <Link href={item.href} className="flex items-center gap-2">
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
                        href="https://discord.gg/learnhouse"
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
                      onClick={() => setFeedbackModalOpen(true)}
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
      </div>
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
            <SearchBar orgslug={orgslug} isMobile={true} />
          </div>
          <div className='py-4'>
            <MenuLinks orgslug={orgslug} />
          </div>
          <div className="border-t border-gray-200">
            <HeaderProfileBox />
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>
  )
}

const CopilotMenuButton = ({ orgslug, iconBtnClass }: { orgslug: string; iconBtnClass: string }) => {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { t } = useTranslation()

  const { data: sessions } = useSWR<RAGChatSession[]>(
    accessToken ? 'menu-rag-sessions' : null,
    () => fetchRAGChatSessions(accessToken),
    { revalidateOnFocus: false }
  )

  const recentSessions = (sessions || []).slice(0, 5)

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 rounded-lg transition-colors hover:bg-violet-500/10"
                aria-label="Copilot"
              >
                <ChatCircle size={20} weight="fill" className="text-violet-500" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Copilot
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <ChatCircle size={16} weight="fill" className="text-violet-500" />
          <span>Copilot</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recentSessions.length > 0 ? (
          <>
            {recentSessions.map((s) => (
              <DropdownMenuItem key={s.aichat_uuid} asChild>
                <Link
                  href={getUriWithOrg(orgslug, `/copilot?chat=${s.aichat_uuid}`)}
                  className="flex items-center gap-2"
                >
                  <ChatCircleDots size={14} weight="fill" className="shrink-0 text-neutral-400" />
                  <span className="truncate text-sm">{s.title || 'Untitled'}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : (
          <div className="px-2 py-3 text-center">
            <p className="text-xs text-neutral-400">No conversations yet</p>
          </div>
        )}
        <DropdownMenuItem asChild>
          <Link
            href={getUriWithOrg(orgslug, '/copilot')}
            className="flex items-center gap-2 font-medium"
          >
            <ChatCircle size={14} weight="fill" className="text-violet-500" />
            <span>{recentSessions.length > 0 ? 'View all conversations' : 'Start a conversation'}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
