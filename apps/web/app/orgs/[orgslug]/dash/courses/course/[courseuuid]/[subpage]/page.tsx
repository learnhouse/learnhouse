'use client'
import React, { use, useEffect } from 'react';
import { CourseProvider } from '../../../../../../../../components/Contexts/CourseContext'
import { CourseOverviewTop } from '@components/Dashboard/Misc/CourseOverviewTop'
import { motion } from 'motion/react'
import { GalleryVerticalEnd, Globe, Info, UserPen, Award, Lock, Search } from 'lucide-react'
import { ChartBar } from '@phosphor-icons/react'
import EditCourseStructure from '@components/Dashboard/Pages/Course/EditCourseStructure/EditCourseStructure'
import EditCourseGeneral from '@components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral'
import EditCourseAccess from '@components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess'
import EditCourseContributors from '@components/Dashboard/Pages/Course/EditCourseContributors/EditCourseContributors'
import EditCourseCertification from '@components/Dashboard/Pages/Course/EditCourseCertification/EditCourseCertification'
import EditCourseSEO from '@components/Dashboard/Pages/Course/EditCourseSEO/EditCourseSEO'
import { useCourseRights } from '@hooks/useCourseRights'
import { useRouter } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config';
import { useTranslation } from 'react-i18next';
import { PlanLevel } from '@services/plans/plans';
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate';
import CourseAnalyticsTab from '@components/Dashboard/Analytics/Course/CourseAnalyticsTab';
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar';

export type CourseOverviewParams = {
  orgslug: string
  courseuuid: string
  subpage: string
}

function CourseOverviewPage(props: { params: Promise<CourseOverviewParams> }) {
  const { t } = useTranslation()
  const params = use(props.params);
  const router = useRouter();

  function getEntireCourseUUID(courseuuid: string) {
    // add course_ to uuid
    return `course_${courseuuid}`
  }

  const courseuuid = getEntireCourseUUID(params.courseuuid)
  const { hasPermission, isLoading: rightsLoading } = useCourseRights(courseuuid)

  // Define tab configurations with their required permissions
  const tabs = [
    {
      key: 'general',
      label: t('dashboard.courses.settings.tabs.general'),
      icon: Info,
      href: `/dash/courses/course/${params.courseuuid}/general`,
      requiredPermission: 'update' as const
    },
    {
      key: 'content',
      label: t('dashboard.courses.settings.tabs.content'),
      icon: GalleryVerticalEnd,
      href: `/dash/courses/course/${params.courseuuid}/content`,
      requiredPermission: 'update_content' as const
    },
    {
      key: 'access',
      label: t('dashboard.courses.settings.tabs.access'),
      icon: Globe,
      href: `/dash/courses/course/${params.courseuuid}/access`,
      requiredPermission: 'manage_access' as const
    },
    {
      key: 'contributors',
      label: t('dashboard.courses.settings.tabs.contributors'),
      icon: UserPen,
      href: `/dash/courses/course/${params.courseuuid}/contributors`,
      requiredPermission: 'manage_contributors' as const
    },
    {
      key: 'seo',
      label: t('dashboard.courses.settings.tabs.seo'),
      icon: Search,
      href: `/dash/courses/course/${params.courseuuid}/seo`,
      requiredPermission: 'update' as const,
      requiresPlan: 'standard' as PlanLevel
    },
    {
      key: 'certification',
      label: t('dashboard.courses.settings.tabs.certification'),
      icon: Award,
      href: `/dash/courses/course/${params.courseuuid}/certification`,
      requiredPermission: 'create_certifications' as const,
      requiresPlan: 'pro' as PlanLevel
    },
    {
      key: 'analytics',
      label: t('dashboard.courses.settings.tabs.analytics'),
      icon: ChartBar,
      href: `/dash/courses/course/${params.courseuuid}/analytics`,
      requiredPermission: 'update' as const,
      requiresPlan: 'pro' as PlanLevel
    }
  ]

  // Filter tabs based on permissions
  const visibleTabs = tabs.filter(tab => hasPermission(tab.requiredPermission))

  // Check if current subpage is accessible
  const currentTab = tabs.find(tab => tab.key === params.subpage)
  const hasAccessToCurrentPage = currentTab ? hasPermission(currentTab.requiredPermission) : false

  // Redirect to first available tab if current page is not accessible
  useEffect(() => {
    if (!rightsLoading && !hasAccessToCurrentPage && visibleTabs.length > 0) {
      const firstAvailableTab = visibleTabs[0]
      router.replace(getUriWithOrg(params.orgslug, '') + firstAvailableTab.href)
    }
  }, [rightsLoading, hasAccessToCurrentPage, visibleTabs, router, params.orgslug])

  // Access denied (rights loaded but no tabs visible)
  if (!rightsLoading && visibleTabs.length === 0) {
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
        <div className="text-center">
          <Lock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('dashboard.courses.settings.access_denied.title')}</h3>
          <p className="text-gray-500">{t('dashboard.courses.settings.access_denied.message')}</p>
        </div>
      </div>
    )
  }

  // CourseProvider is always rendered so course meta fetches IN PARALLEL with rights —
  // no sequential waterfall. The tab content is gated by hasPermission() which returns
  // false (safe default) until rights finish loading.
  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1">
      <CourseProvider courseuuid={courseuuid} withUnpublishedActivities={true}>
        <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative min-w-0 overflow-hidden">
          <CourseOverviewTop params={params} />
          <DashTabBar tabs={tabs.map((tab) => {
            const hasAccess = hasPermission(tab.requiredPermission)
            const IconComponent = tab.icon
            return {
              key: tab.key,
              label: tab.label,
              icon: <IconComponent size={16} />,
              href: getUriWithOrg(params.orgslug, '') + tab.href,
              active: params.subpage.toString() === tab.key,
              disabled: !hasAccess,
              disabledTooltip: !hasAccess ? (
                <div className="text-center">
                  <div className="font-medium text-gray-900">{t('dashboard.courses.settings.access_restricted.title')}</div>
                  <div className="text-sm text-gray-600">
                    {t('dashboard.courses.settings.access_restricted.message', { tab: tab.label })}
                  </div>
                </div>
              ) : undefined,
              requiresPlan: tab.requiresPlan,
            } as DashTabItem
          })} />
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="h-full overflow-y-auto overflow-x-hidden"
        >
          <div>
            {rightsLoading ? (
              <div className="p-10 space-y-4 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-48" />
                <div className="h-4 bg-gray-200 rounded w-full max-w-xl" />
                <div className="h-4 bg-gray-200 rounded w-full max-w-md" />
                <div className="h-32 bg-gray-200 rounded w-full max-w-2xl mt-6" />
              </div>
            ) : null}
            {!rightsLoading && params.subpage == 'content' && hasPermission('update_content') ? (
              <EditCourseStructure orgslug={params.orgslug} />
            ) : null}
            {!rightsLoading && params.subpage == 'general' && hasPermission('update') ? (
              <EditCourseGeneral orgslug={params.orgslug} />
            ) : null}
            {!rightsLoading && params.subpage == 'access' && hasPermission('manage_access') ? (
              <EditCourseAccess orgslug={params.orgslug} />
            ) : null}
            {!rightsLoading && params.subpage == 'contributors' && hasPermission('manage_contributors') ? (
              <EditCourseContributors orgslug={params.orgslug} />
            ) : null}
            {!rightsLoading && params.subpage == 'seo' && hasPermission('update') ? (
              <>
                <div className="h-6" />
                <FeatureGate feature="seo">
                  <EditCourseSEO orgslug={params.orgslug} />
                </FeatureGate>
              </>
            ) : null}
            {!rightsLoading && params.subpage == 'certification' && hasPermission('create_certifications') ? (
              <>
                <div className="h-6" />
                <FeatureGate feature="certifications">
                  <EditCourseCertification orgslug={params.orgslug} />
                </FeatureGate>
              </>
            ) : null}
            {!rightsLoading && params.subpage == 'analytics' && hasPermission('update') ? (
              <FeatureGate feature="course_analytics">
                <CourseAnalyticsTab courseUUID={courseuuid} />
              </FeatureGate>
            ) : null}
          </div>
        </motion.div>
      </CourseProvider>
    </div>
  )
}

export default CourseOverviewPage
