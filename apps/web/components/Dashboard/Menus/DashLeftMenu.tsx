'use client'
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
  Question,
  Gear,
  SignOut,
  Package,
  SidebarSimple,
  Check,
  CaretDown,
  PencilSimple,
  ChatsCircle,
  Book,
  ChatCircleDots,
  Headphones,
} from '@phosphor-icons/react'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg, getUriWithoutOrg, getAPIUrl } from '@services/config/config'
import { useTranslation } from 'react-i18next'
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
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { getAssignmentsFromACourse } from '@services/courses/assignments'
import { DASHBOARD_MENU_ITEMS } from '@/lib/dashboard-menu-items'

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const { t, i18n } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [recentAssignments, setRecentAssignments] = useState<any[]>([])
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const access_token = session?.data?.tokens?.access_token

  // SWR key for courses
  const coursesKey = org?.slug ? `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/8` : null

  // Fetch recent courses
  const { data: coursesData } = useSWR(
    coursesKey,
    (url) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  )
  const recentCourses = coursesData?.slice(0, 8) || []

  // Fetch assignments from courses
  const [assignmentsRefreshKey, setAssignmentsRefreshKey] = useState(0)

  useEffect(() => {
    if (coursesData && access_token) {
      const coursesToFetch = coursesData.slice(0, 5)
      const promises = coursesToFetch.map((course: any) =>
        getAssignmentsFromACourse(course.course_uuid, access_token)
      )

      Promise.all(promises).then((results) => {
        const allAssignments: any[] = []
        results.forEach((res: any, index: number) => {
          if (res?.data) {
            res.data.forEach((assignment: any) => {
              allAssignments.push({
                ...assignment,
                courseName: coursesToFetch[index].name
              })
            })
          }
        })
        setRecentAssignments(allAssignments.slice(0, 8))
      }).catch(() => {
        // Silently ignore errors
      })
    }
  }, [coursesData, access_token, assignmentsRefreshKey])

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => {
      // Revalidate courses SWR cache
      if (coursesKey) {
        mutate(coursesKey)
      }
      // Trigger assignments refetch
      setAssignmentsRefreshKey(prev => prev + 1)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [coursesKey])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dash-menu-collapsed')
      if (saved !== null) {
        setIsCollapsed(saved === 'true')
      }
    }
  }, [])

  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('dash-menu-collapsed', String(newState))
  }

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }

  if (!org || !session) return null

  const plan = org?.config?.config?.cloud?.plan || 'free'

  return (
    <TooltipProvider delayDuration={0}>
    <div
      className={cn(
        "flex flex-col text-white h-screen sticky top-0 z-overlay border-r border-white/[0.08] bg-[#0f0f10] transition-all duration-300",
        isCollapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Header with Logo and Toggle */}
      <div className={cn(
        "flex items-center h-16 border-b border-white/[0.08] px-4 shrink-0",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        <Link
          className={cn("flex items-center transition-opacity hover:opacity-70", isCollapsed ? "" : "space-x-3")}
          href={'/'}
        >
          {plan === 'enterprise' && org?.logo_image ? (
            <img
              src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
              alt={org?.name}
              className="h-9 w-9 object-contain rounded-lg"
            />
          ) : (
            <img
              src="/lrn-dash.svg"
              alt="Learnhouse logo"
              className="h-8 w-8"
            />
          )}
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-sm text-white truncate">
                {org?.name}
              </span>
              <span className={cn(
                "text-[9px] font-medium uppercase tracking-wider",
                plan === 'enterprise' ? "text-amber-400" :
                plan === 'pro' ? "text-purple-400" :
                plan === 'standard' ? "text-blue-400" :
                "text-white/40"
              )}>
                {plan}
              </span>
            </div>
          )}
        </Link>

        {!isCollapsed && (
          <button
            onClick={toggleCollapse}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            <SidebarSimple size={18} weight="fill" />
          </button>
        )}
      </div>

      {/* Main Navigation - Vertically Centered */}
      <div className="flex-1 flex flex-col justify-center py-4 px-3">
        <AdminAuthorization authorizationMode="component">
          <div className="space-y-1">
            <MenuLink
              href="/dash"
              icon={<House size={20} weight="fill" />}
              label={t('common.home')}
              isCollapsed={isCollapsed}
            />

            {/* Courses with hover menu */}
            <HoverMenu
              content={
                <HoverMenuContent className="w-64">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('courses.courses')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/courses" className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors">
                      <BookOpen size={16} weight="fill" />
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
                            className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
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
              <button
                className={cn(
                  "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all",
                  isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
                )}
              >
                <span className="relative flex items-center justify-center">
                  <BookOpen size={20} weight="fill" />
                  {isCollapsed && (
                    <CaretDown size={8} weight="bold" className="absolute -right-2.5 text-white/30" />
                  )}
                </span>
                {!isCollapsed && (
                  <>
                    <span className="text-sm font-medium flex-1 text-left">{t('courses.courses')}</span>
                    <CaretDown size={14} weight="bold" className="text-white/40" />
                  </>
                )}
              </button>
            </HoverMenu>

            {/* Assignments with hover menu */}
            <HoverMenu
              content={
                <HoverMenuContent className="w-72">
                  <HoverMenuLabel className="text-white/70 font-medium">{t('common.assignments')}</HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <Link href="/dash/assignments" className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors">
                      <Files size={16} weight="fill" />
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
                            className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
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
              <button
                className={cn(
                  "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all",
                  isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
                )}
              >
                <span className="relative flex items-center justify-center">
                  <Files size={20} weight="fill" />
                  {isCollapsed && (
                    <CaretDown size={8} weight="bold" className="absolute -right-2.5 text-white/30" />
                  )}
                </span>
                {!isCollapsed && (
                  <>
                    <span className="text-sm font-medium flex-1 text-left">{t('common.assignments')}</span>
                    <CaretDown size={14} weight="bold" className="text-white/40" />
                  </>
                )}
              </button>
            </HoverMenu>
            <MenuLink
              href="/dash/communities"
              icon={<ChatsCircle size={20} weight="fill" />}
              label={t('communities.title')}
              isCollapsed={isCollapsed}
            />
            <MenuLink
              href="/dash/podcasts"
              icon={<Headphones size={20} weight="fill" />}
              label={t('podcasts.podcasts')}
              isCollapsed={isCollapsed}
            />
            <MenuLink
              href="/dash/users/settings/users"
              icon={<Users size={20} weight="fill" />}
              label={t('common.users')}
              isCollapsed={isCollapsed}
            />
            <MenuLink
              href="/dash/payments/customers"
              icon={<CurrencyCircleDollar size={20} weight="fill" />}
              label={t('common.payments')}
              isCollapsed={isCollapsed}
            />
            <MenuLink
              href="/dash/org/settings/general"
              icon={<Buildings size={20} weight="fill" />}
              label={t('common.organization')}
              isCollapsed={isCollapsed}
            />
          </div>
        </AdminAuthorization>
      </div>

      {/* Bottom Section */}
      <div className="border-t border-white/[0.08] py-3 px-3 shrink-0">
        <div className="space-y-1">
          {/* Expand button when collapsed */}
          {isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapse}
                  className="flex items-center justify-center w-full h-10 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
                >
                  <SidebarSimple size={20} weight="fill" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-tooltip bg-[#1a1a1b] border-white/10 text-white text-xs px-2 py-1 shadow-lg shadow-black/20">
                {t('common.expand')}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Language Switcher with hover menu */}
          <HoverMenu
            align="end"
            content={
              <HoverMenuContent className="w-64 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <HoverMenuLabel className="flex items-center gap-2 text-white/70 font-medium">
                  <Globe size={16} weight="fill" />
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
                    {i18n.language === language.code && (
                      <Check size={16} weight="bold" className="text-green-500" />
                    )}
                  </HoverMenuItem>
                ))}
              </HoverMenuContent>
            }
          >
            <button className={cn(
              "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all group",
              isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
            )}>
              <Globe size={20} weight="fill" />
              {!isCollapsed && (
                <span className="text-sm font-medium">{t('common.language')}</span>
              )}
            </button>
          </HoverMenu>

          {/* Help with hover menu */}
          <HoverMenu
            align="end"
            content={
              <HoverMenuContent className="w-56">
                <HoverMenuLabel className="flex items-center gap-2 text-white/70 font-medium">
                  <Question size={16} weight="fill" />
                  <span>{t('common.help')}</span>
                </HoverMenuLabel>
                <HoverMenuSeparator />
                <HoverMenuItem asChild>
                  <a
                    href="https://docs.learnhouse.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
                  >
                    <Book size={16} weight="fill" />
                    <span>{t('common.help_menu.documentation')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://learnhouse.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
                  >
                    <Globe size={16} weight="fill" />
                    <span>{t('common.help_menu.website')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://discord.gg/learnhouse"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
                  >
                    <DiscordIcon size={16} />
                    <span>{t('common.help_menu.discord')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuSeparator />
                <HoverMenuItem
                  onClick={() => setFeedbackModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
                >
                  <ChatCircleDots size={16} weight="fill" />
                  <span>{t('common.help_menu.report_feedback')}</span>
                </HoverMenuItem>
              </HoverMenuContent>
            }
          >
            <button className={cn(
              "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all group",
              isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
            )}>
              <Question size={20} weight="fill" />
              {!isCollapsed && (
                <span className="text-sm font-medium">{t('common.help')}</span>
              )}
            </button>
          </HoverMenu>

          {/* User Menu with hover menu */}
          <HoverMenu
            align="end"
            content={
              <HoverMenuContent className="w-56">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-white/90">{session?.data?.user?.username}</p>
                  <p className="text-xs text-white/40">{session?.data?.user?.email}</p>
                </div>
                <HoverMenuSeparator />
                <HoverMenuItem asChild>
                  <Link href="/account/general" className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors">
                    <Gear size={16} weight="fill" />
                    <span>{t('common.settings')}</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <Link href="/account/my-courses" className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors">
                    <Package size={16} weight="fill" />
                    <span>{t('courses.my_courses')}</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuSeparator />
                <HoverMenuItem
                  onClick={() => logOutUI()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:text-red-400 hover:bg-white/[0.08] cursor-pointer transition-colors"
                >
                  <SignOut size={16} weight="fill" />
                  <span>{t('user.sign_out')}</span>
                </HoverMenuItem>
              </HoverMenuContent>
            }
          >
            <button className={cn(
              "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all group",
              isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
            )}>
              <UserAvatar width={24} rounded="rounded-full" shadow="shadow-none" />
              {!isCollapsed && (
                <div className="flex flex-col min-w-0 flex-1 text-left">
                  <span className="text-sm font-medium truncate text-white/90">{session?.data?.user?.username}</span>
                  <span className="text-xs text-white/40 truncate">{session?.data?.user?.email}</span>
                </div>
              )}
            </button>
          </HoverMenu>
        </div>
      </div>
    </div>

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

const MenuLink = ({ href, icon, label, isCollapsed, isExternal }: {
  href: string
  icon: React.ReactNode
  label: string
  isCollapsed: boolean
  isExternal?: boolean
}) => {
  const content = (
    <div
      className={cn(
        "flex items-center w-full rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-all",
        isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
      )}
    >
      {icon}
      {!isCollapsed && (
        <span className="text-sm font-medium">{label}</span>
      )}
    </div>
  )

  const linkElement = isExternal ? (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {content}
    </a>
  ) : (
    <Link aria-label={label} href={href}>
      {content}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {linkElement}
        </TooltipTrigger>
        <TooltipContent side="right" className="z-tooltip bg-[#1a1a1b] border-white/10 text-white text-xs px-2 py-1 shadow-lg shadow-black/20">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return linkElement
}

export default DashLeftMenu
