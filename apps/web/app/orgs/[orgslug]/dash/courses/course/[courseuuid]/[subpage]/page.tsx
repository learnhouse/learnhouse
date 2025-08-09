'use client'
import { getUriWithOrg } from '@services/config/config'
import React, { use, useEffect } from 'react';
import { CourseProvider } from '../../../../../../../../components/Contexts/CourseContext'
import Link from 'next/link'
import { CourseOverviewTop } from '@components/Dashboard/Misc/CourseOverviewTop'
import { motion } from 'framer-motion'
import { GalleryVerticalEnd, Globe, Info, UserPen, UserRoundCog, Users, Award, Lock } from 'lucide-react'
import EditCourseStructure from '@components/Dashboard/Pages/Course/EditCourseStructure/EditCourseStructure'
import EditCourseGeneral from '@components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral'
import EditCourseAccess from '@components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess'
import EditCourseContributors from '@components/Dashboard/Pages/Course/EditCourseContributors/EditCourseContributors'
import EditCourseCertification from '@components/Dashboard/Pages/Course/EditCourseCertification/EditCourseCertification'
import { useCourseRights } from '@hooks/useCourseRights'
import { useRouter } from 'next/navigation'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

export type CourseOverviewParams = {
  orgslug: string
  courseuuid: string
  subpage: string
}

function CourseOverviewPage(props: { params: Promise<CourseOverviewParams> }) {
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
      label: 'General',
      icon: Info,
      href: `/dash/courses/course/${params.courseuuid}/general`,
      requiredPermission: 'update' as const
    },
    {
      key: 'content',
      label: 'Content',
      icon: GalleryVerticalEnd,
      href: `/dash/courses/course/${params.courseuuid}/content`,
      requiredPermission: 'update_content' as const
    },
    {
      key: 'access',
      label: 'Access',
      icon: Globe,
      href: `/dash/courses/course/${params.courseuuid}/access`,
      requiredPermission: 'manage_access' as const
    },
    {
      key: 'contributors',
      label: 'Contributors',
      icon: UserPen,
      href: `/dash/courses/course/${params.courseuuid}/contributors`,
      requiredPermission: 'manage_contributors' as const
    },
    {
      key: 'certification',
      label: 'Certification',
      icon: Award,
      href: `/dash/courses/course/${params.courseuuid}/certification`,
      requiredPermission: 'create_certifications' as const
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

  // Show loading state while rights are being fetched
  if (rightsLoading) {
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  // Show access denied if no tabs are available
  if (!rightsLoading && visibleTabs.length === 0) {
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
        <div className="text-center">
          <Lock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
          <p className="text-gray-500">You don't have permission to access this course.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr]">
      <CourseProvider courseuuid={courseuuid} withUnpublishedActivities={true}>
        <div className="pl-10 pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow">
          <CourseOverviewTop params={params} />
          <div className="flex space-x-3 font-black text-sm">
            {tabs.map((tab) => {
              const IconComponent = tab.icon
              const isActive = params.subpage.toString() === tab.key
              const hasAccess = hasPermission(tab.requiredPermission)
              
              if (!hasAccess) {
                // Show disabled tab with subtle visual cues and tooltip
                return (
                  <ToolTip
                    key={tab.key}
                    content={
                      <div className="text-center">
                        <div className="font-medium text-gray-900">Access Restricted</div>
                        <div className="text-sm text-gray-600">
                          You don't have permission to access {tab.label}
                        </div>
                      </div>
                    }
                  >
                    <div className="flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear opacity-30 cursor-not-allowed">
                      <div className="flex items-center space-x-2.5 mx-2">
                        <IconComponent size={16} />
                        <div>{tab.label}</div>
                      </div>
                    </div>
                  </ToolTip>
                )
              }
              
              return (
                <Link
                  key={tab.key}
                  href={getUriWithOrg(params.orgslug, '') + tab.href}
                >
                  <div
                    className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${
                      isActive ? 'border-b-4' : 'opacity-50 hover:opacity-75'
                    } cursor-pointer`}
                  >
                    <div className="flex items-center space-x-2.5 mx-2">
                      <IconComponent size={16} />
                      <div>{tab.label}</div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="h-full overflow-y-auto relative"
        >
          <div className="absolute inset-0">
            {params.subpage == 'content' && hasPermission('update_content') ? (
              <EditCourseStructure orgslug={params.orgslug} />
            ) : null}
            {params.subpage == 'general' && hasPermission('update') ? (
              <EditCourseGeneral orgslug={params.orgslug} />
            ) : null}
            {params.subpage == 'access' && hasPermission('manage_access') ? (
              <EditCourseAccess orgslug={params.orgslug} />
            ) : null}
            {params.subpage == 'contributors' && hasPermission('manage_contributors') ? (
              <EditCourseContributors orgslug={params.orgslug} />
            ) : null}
            {params.subpage == 'certification' && hasPermission('create_certifications') ? (
              <EditCourseCertification orgslug={params.orgslug} />
            ) : null}
          </div>
        </motion.div>
      </CourseProvider>
    </div>
  )
}

export default CourseOverviewPage
