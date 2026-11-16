'use client'
import React, { use } from 'react'
import dynamic from 'next/dynamic'
import { useCourseRights } from '@components/Hooks/useCourseRights'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { EditorPage, EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { usePreloadOnIdle } from '@components/Dashboard/Shared/usePreloadOnIdle'
import { useEditingLocale } from '@components/Dashboard/Pages/Course/EditCourseLanguages/useCourseLanguages'

// The header, tabs and course store live in ../layout.tsx and stay mounted;
// this page is only the tab body.

// One chunk per tab: only the open tab's code (charts, editors) is loaded.
// The skeleton keeps the body steady while a chunk loads for the first time.
const tabLoading = () => (
  <EditorPage>
    <EditorSkeleton sections={2} />
  </EditorPage>
)
const EditCourseStructure = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseStructure/EditCourseStructure'), { loading: tabLoading })
const EditCourseGeneral = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral'), { loading: tabLoading })
const EditCourseAccess = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess'), { loading: tabLoading })
const EditCourseContributors = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseContributors/EditCourseContributors'), { loading: tabLoading })
const EditCourseCertification = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseCertification/EditCourseCertification'), { loading: tabLoading })
const EditCourseSEO = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseSEO/EditCourseSEO'), { loading: tabLoading })
const EditCourseSchedule = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseSchedule/EditCourseSchedule'), { loading: tabLoading })
const EditCourseLanguages = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseLanguages/EditCourseLanguages'), { loading: tabLoading })
// Translation mode (`?lang=fr`): the translated tabs swap their body
const TranslateCourseGeneral = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseLanguages/TranslateCourseGeneral'), { loading: tabLoading })
const TranslateCourseStructure = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseLanguages/TranslateCourseStructure'), { loading: tabLoading })
const TranslateCourseSEO = dynamic(() => import('@components/Dashboard/Pages/Course/EditCourseLanguages/TranslateCourseSEO'), { loading: tabLoading })
const CourseAnalyticsTab = dynamic(() => import('@ee/components/Analytics/Dashboard/Course/CourseAnalyticsTab'), { loading: tabLoading })

// The other tabs' code, fetched while the browser is idle (see
// usePreloadOnIdle). Not analytics: its charts are heavy and rarely opened.
const TAB_CHUNKS = [
  () => import('@components/Dashboard/Pages/Course/EditCourseStructure/EditCourseStructure'),
  () => import('@components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral'),
  () => import('@components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess'),
  () => import('@components/Dashboard/Pages/Course/EditCourseContributors/EditCourseContributors'),
  () => import('@components/Dashboard/Pages/Course/EditCourseCertification/EditCourseCertification'),
  () => import('@components/Dashboard/Pages/Course/EditCourseSEO/EditCourseSEO'),
  () => import('@components/Dashboard/Pages/Course/EditCourseSchedule/EditCourseSchedule'),
]

export type CourseOverviewParams = {
  orgslug: string
  courseuuid: string
  subpage: string
}

function CourseEditorTabPage(props: { params: Promise<CourseOverviewParams> }) {
  const params = use(props.params)
  const courseuuid = `course_${params.courseuuid}`
  // Same query as the layout, so this reads the cached rights.
  const { hasPermission, isLoading: rightsLoading } = useCourseRights(courseuuid)
  usePreloadOnIdle(TAB_CHUNKS)
  const { locale } = useEditingLocale(courseuuid)

  if (rightsLoading) return tabLoading()

  if (locale && hasPermission('update')) {
    if (params.subpage === 'general') return <TranslateCourseGeneral locale={locale} />
    if (params.subpage === 'content') return <TranslateCourseStructure locale={locale} orgslug={params.orgslug} />
    if (params.subpage === 'seo')
      return (
        <FeatureGate feature="seo">
          <TranslateCourseSEO locale={locale} />
        </FeatureGate>
      )
  }

  switch (params.subpage) {
    case 'content':
      return hasPermission('update_content') ? <EditCourseStructure orgslug={params.orgslug} /> : null
    case 'general':
      return hasPermission('update') ? <EditCourseGeneral orgslug={params.orgslug} /> : null
    case 'schedule':
      return hasPermission('update') ? (
        <FeatureGate feature="drip">
          <EditCourseSchedule orgslug={params.orgslug} />
        </FeatureGate>
      ) : null
    case 'access':
      return hasPermission('manage_access') ? <EditCourseAccess orgslug={params.orgslug} /> : null
    case 'contributors':
      return hasPermission('manage_contributors') ? <EditCourseContributors orgslug={params.orgslug} /> : null
    case 'seo':
      return hasPermission('update') ? (
        <FeatureGate feature="seo">
          <EditCourseSEO orgslug={params.orgslug} />
        </FeatureGate>
      ) : null
    case 'languages':
      return hasPermission('update') ? <EditCourseLanguages orgslug={params.orgslug} /> : null
    case 'certification':
      // Plan-gates only the certificate part; the completion screen is open to all.
      return hasPermission('create_certifications') ? <EditCourseCertification orgslug={params.orgslug} /> : null
    case 'analytics':
      return hasPermission('update') ? (
        // The analytics tab pads itself by p-6; this brings it to the page gutter.
        <div className="sm:px-4 pt-2">
          <FeatureGate feature="course_analytics">
            <CourseAnalyticsTab courseUUID={courseuuid} />
          </FeatureGate>
        </div>
      ) : null
    default:
      return null
  }
}

export default CourseEditorTabPage
