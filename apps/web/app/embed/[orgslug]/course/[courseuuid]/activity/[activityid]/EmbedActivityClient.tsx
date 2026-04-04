'use client'

import React, { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'
import Image from 'next/image'
import { CourseContext, CourseDispatchContext } from '@components/Contexts/CourseContext'

const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))

// Minimal course context for embed
function EmbedCourseProvider({ children }: { children: React.ReactNode }) {
  const minimalState = {
    courseStructure: null,
    courseOrder: null,
    pendingChanges: {},
    isSaved: true,
    isLoading: false,
    isSaving: false,
    saveError: null,
    withUnpublishedActivities: false,
    lastSyncedAt: null,
  }

  return (
    <CourseContext.Provider value={minimalState}>
      <CourseDispatchContext.Provider value={() => {}}>
        {children}
      </CourseDispatchContext.Provider>
    </CourseContext.Provider>
  )
}

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="relative w-6 h-6">
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-100 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-2 border-gray-400 rounded-full animate-spin border-t-transparent"></div>
    </div>
  </div>
)

interface EmbedActivityClientProps {
  activity: any
  course: any
  activityId: string
  orgslug: string
}

const EMBEDDABLE_TYPES = ['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT']

function EmbedActivityClient({ activity, course, activityId, orgslug }: EmbedActivityClientProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const showLearnHouseLogo = searchParams.get('showlearnhouselogo') !== 'false'
  const isEmbeddable = EMBEDDABLE_TYPES.includes(activity.activity_type)

  const getActivityUrl = () => {
    const cleanCourseUuid = course.course_uuid.replace('course_', '')
    return getUriWithOrg(orgslug, `/course/${cleanCourseUuid}/activity/${activityId}`)
  }

  if (!isEmbeddable) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="mb-6">
            <Image
              src="/learnhouse_bigicon.png"
              alt="LearnHouse"
              width={64}
              height={64}
              className="mx-auto"
            />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {t('embed.not_supported_title')}
          </h1>
          <p className="text-gray-600 mb-6">
            {t('embed.not_supported_description')}
          </p>
          <a
            href={getActivityUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-gray-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            {t('embed.visit_activity')}
          </a>
        </div>
        {showLearnHouseLogo && <PoweredByBadge activityUrl={getActivityUrl()} />}
      </div>
    )
  }

  const renderActivityContent = () => {
    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        return (
          <EmbedCourseProvider>
            <Suspense fallback={<LoadingFallback />}>
              <Canva content={activity.content} activity={activity} hideTableOfContents />
            </Suspense>
          </EmbedCourseProvider>
        )
      case 'TYPE_VIDEO':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <VideoActivity activity={activity} course={course} />
          </Suspense>
        )
      case 'TYPE_DOCUMENT':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DocumentPdfActivity activity={activity} course={course} />
          </Suspense>
        )
      default:
        return null
    }
  }

  const bgColor = activity.activity_type === 'TYPE_DYNAMIC' ? 'bg-white' : 'bg-zinc-950'

  return (
    <div className="min-h-screen relative">
      <div className={`${bgColor} p-4`}>
        {renderActivityContent()}
      </div>
      {showLearnHouseLogo && <PoweredByBadge activityUrl={getActivityUrl()} />}
    </div>
  )
}

function PoweredByBadge({ activityUrl }: { activityUrl: string }) {
  const handleClick = () => {
    window.open(activityUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={handleClick}
        className="bg-white/80 backdrop-blur-lg rounded-2xl p-2 light-shadow block cursor-pointer"
      >
        <Image
          src="/lrn.svg"
          alt="LearnHouse"
          width={20}
          height={20}
        />
      </button>
    </div>
  )
}

export default EmbedActivityClient
