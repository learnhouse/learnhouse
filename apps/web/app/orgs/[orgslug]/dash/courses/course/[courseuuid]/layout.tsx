'use client'
import React, { use, useEffect } from 'react'
import { useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { Books, ChartBar, Rows, Globe, Info, UserGear, Medal, Lock, MagnifyingGlass, CalendarCheck, Translate } from '@phosphor-icons/react'
import { CourseProvider, useCourse } from '@components/Contexts/CourseContext'
import { CourseOverviewTop } from '@components/Dashboard/Misc/CourseOverviewTop'
import { useCourseRights } from '@components/Hooks/useCourseRights'
import { getUriWithOrg } from '@services/config/config'
import { PlanLevel } from '@services/plans/plans'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { EmptyState, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  CourseEditorSaveProvider,
  useEditorDrafts,
  useLeaveGuard,
} from '@components/Dashboard/Pages/Course/courseEditorSave'
import { courseMetaDirtyTabs } from '@components/Dashboard/Pages/Course/courseEditorTabs'
import { withLangParam } from '@components/Dashboard/Pages/Course/EditCourseLanguages/courseLanguagesModel'
import { TranslationModeBanner } from '@components/Dashboard/Pages/Course/EditCourseLanguages/TranslationModeBanner'

type CourseEditorLayoutParams = {
  orgslug: string
  courseuuid: string
}

type CourseRightsKey =
  | 'update'
  | 'update_content'
  | 'manage_access'
  | 'manage_contributors'
  | 'create_certifications'

export type CourseEditorTab = {
  key: string
  label: string
  icon: React.ElementType
  requiredPermission: CourseRightsKey
  requiresPlan?: PlanLevel
}

// The editor shell: header, tabs and the course data stay mounted here while
// only the tab body (the [subpage] page) swaps. Before, all of this lived in
// the page, so every tab change re-suspended, re-mounted the header and
// re-created the course store, which looked like a full page reload.
export default function CourseEditorLayout(props: {
  children: React.ReactNode
  params: Promise<CourseEditorLayoutParams>
}) {
  const { t } = useTranslation()
  const params = use(props.params)
  const router = useRouter()
  const subpage = useSelectedLayoutSegment() ?? 'general'
  const courseuuid = `course_${params.courseuuid}`
  const { hasPermission, isLoading: rightsLoading, error: rightsError } = useCourseRights(courseuuid)

  const allTabs: CourseEditorTab[] = [
    { key: 'general', label: t('dashboard.courses.settings.tabs.general'), icon: Info, requiredPermission: 'update' },
    { key: 'content', label: t('dashboard.courses.settings.tabs.content'), icon: Rows, requiredPermission: 'update_content' },
    {
      key: 'schedule',
      label: t('dashboard.courses.settings.tabs.schedule', 'Schedule'),
      icon: CalendarCheck,
      requiredPermission: 'update',
      requiresPlan: 'standard',
    },
    { key: 'access', label: t('dashboard.courses.settings.tabs.access'), icon: Globe, requiredPermission: 'manage_access' },
    {
      key: 'contributors',
      label: t('dashboard.courses.settings.tabs.contributors'),
      icon: UserGear,
      requiredPermission: 'manage_contributors',
    },
    {
      key: 'seo',
      label: t('dashboard.courses.settings.tabs.seo'),
      icon: MagnifyingGlass,
      requiredPermission: 'update',
      requiresPlan: 'standard',
    },
    {
      key: 'languages',
      label: t('dashboard.courses.languages.tab', 'Languages'),
      icon: Translate,
      requiredPermission: 'update',
    },
    {
      key: 'certification',
      label: t('dashboard.courses.settings.tabs.certification'),
      icon: Medal,
      requiredPermission: 'create_certifications',
      // No plan badge: the completion screen settings here are on every plan;
      // the certificate section gates itself.
    },
    {
      key: 'analytics',
      label: t('dashboard.courses.settings.tabs.analytics'),
      icon: ChartBar,
      requiredPermission: 'update',
      requiresPlan: 'pro',
    },
  ]
  // Course analytics ship with Enterprise Edition; the tab is hidden without it.
  const tabs = allTabs.filter((tab) => tab.key !== 'analytics' || isOrgAnalyticsAvailable())

  const visibleTabs = tabs.filter((tab) => hasPermission(tab.requiredPermission))
  const currentTab = tabs.find((tab) => tab.key === subpage)
  const hasAccessToCurrentPage = currentTab ? hasPermission(currentTab.requiredPermission) : false
  // Translation mode (?lang=fr) follows the user from tab to tab
  const lang = useSearchParams()?.get('lang') ?? null
  const tabHref = (key: string) =>
    withLangParam(getUriWithOrg(params.orgslug, '') + `/dash/courses/course/${params.courseuuid}/${key}`, key === 'languages' ? null : lang)
  const firstTabKey = visibleTabs[0]?.key

  // Send the user to the first tab they may open when the current one is off limits.
  useEffect(() => {
    if (!rightsLoading && !hasAccessToCurrentPage && firstTabKey) {
      router.replace(tabHref(firstTabKey))
    }
    // tabHref only depends on the params below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightsLoading, hasAccessToCurrentPage, firstTabKey, router, params.orgslug, params.courseuuid])

  // A course that does not exist (deleted, or a wrong link): say so, rather
  // than "access denied" or an editor full of stale data.
  const notFound = (
    <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center px-4" data-testid="course-not-found">
      <EmptyState
        icon={<Books size={22} />}
        title={t('dashboard.courses.editor.not_found.title')}
        description={t('dashboard.courses.editor.not_found.message')}
        action={
          <Link href={getUriWithOrg(params.orgslug, '/dash/courses')} className={buttonClass('primary', 'md')}>
            {t('dashboard.courses.editor.not_found.back')}
          </Link>
        }
      />
    </div>
  )
  if ((rightsError as any)?.status === 404) return notFound

  if (!rightsLoading && visibleTabs.length === 0) {
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center px-4">
        <EmptyState
          icon={<Lock size={22} />}
          title={t('dashboard.courses.settings.access_denied.title')}
          description={t('dashboard.courses.settings.access_denied.message')}
        />
      </div>
    )
  }

  // CourseProvider renders right away so the course loads in parallel with
  // the rights; the tab bodies wait for rights before showing anything.
  return (
    <CourseProvider
      courseuuid={courseuuid}
      withUnpublishedActivities={true}
      notFoundFallback={notFound}
    >
      <CourseEditorSaveProvider>
        <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1">
          <header className="px-4 sm:px-10 bg-white nice-shadow z-10 relative min-w-0">
            <CourseOverviewTop params={{ orgslug: params.orgslug, courseuuid: params.courseuuid, subpage }} />
            <EditorTabs
              tabs={tabs}
              subpage={subpage}
              hasPermission={hasPermission}
              tabHref={tabHref}
              guardPath={`/dash/courses/course/${params.courseuuid}`}
            />
          </header>
          <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
            <TranslationModeBanner courseUuid={courseuuid} subpage={subpage} />
            {props.children}
          </div>
        </div>
      </CourseEditorSaveProvider>
    </CourseProvider>
  )
}

function EditorTabs({
  tabs,
  subpage,
  hasPermission,
  tabHref,
  guardPath,
}: {
  tabs: CourseEditorTab[]
  subpage: string
  hasPermission: (permission: CourseRightsKey) => boolean
  tabHref: (key: string) => string
  guardPath: string
}) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const { hasDrafts, dirtyTabs } = useEditorDrafts()

  // Unsaved course fields, mapped to the tab that edits them.
  const metaTabs = courseMetaDirtyTabs({ ...course?.pendingChanges, ...course?.unsyncedChanges })
  const reorderDirty = !course?.isSaved && metaTabs.size === 0
  const isDirty = (key: string) => dirtyTabs.has(key) || metaTabs.has(key) || (key === 'content' && reorderDirty)

  useLeaveGuard(
    !(course?.isSaved ?? true) || hasDrafts,
    guardPath,
    t('dashboard.courses.editor.save.leave_confirm')
  )

  return (
    <DashTabBar
      className="mt-2 sm:mt-3 -mb-px"
      tabs={tabs.map((tab) => {
        const hasAccess = hasPermission(tab.requiredPermission)
        const IconComponent = tab.icon
        return {
          key: tab.key,
          label: tab.label,
          icon: <IconComponent size={16} />,
          href: tabHref(tab.key),
          active: subpage === tab.key,
          disabled: !hasAccess,
          dirty: hasAccess && isDirty(tab.key),
          disabledTooltip: !hasAccess ? (
            <div className="text-center">
              <div className="font-medium text-neutral-900">{t('dashboard.courses.settings.access_restricted.title')}</div>
              <div className="text-sm text-neutral-600">
                {t('dashboard.courses.settings.access_restricted.message', { tab: tab.label })}
              </div>
            </div>
          ) : undefined,
          requiresPlan: tab.requiresPlan,
        } as DashTabItem
      })}
    />
  )
}
