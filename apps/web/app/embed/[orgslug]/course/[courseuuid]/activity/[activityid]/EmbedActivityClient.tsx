'use client'

import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'
import Image from 'next/image'
import { CourseContext, CourseDispatchContext } from '@components/Contexts/CourseContext'

const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))

// Minimal course context for embed — courseStructure must be populated
// so that block components (Image, Video, Audio, PDF) can resolve media URLs.
function EmbedCourseProvider({ children, course }: { children: React.ReactNode; course: any }) {
  const minimalState = {
    courseStructure: course,
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

interface EmbedActivityClientProps {
  activity: any
  course: any
  activityId: string
  orgslug: string
}

const EMBEDDABLE_TYPES = ['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT']

// Returns a selector for the DOM element that signals content is ready.
function getReadySelector(activityType: string, activitySubType?: string): string {
  if (activitySubType === 'SUBTYPE_DYNAMIC_MARKDOWN') return '.markdown-body'
  if (activitySubType === 'SUBTYPE_DYNAMIC_EMBED') return 'iframe'
  switch (activityType) {
    case 'TYPE_DYNAMIC':
      // TipTap editor with rendered content
      return '.ProseMirror'
    case 'TYPE_VIDEO':
      return 'video, iframe'
    case 'TYPE_DOCUMENT':
      return 'iframe'
    default:
      return '*'
  }
}

function useContentReady(activityType: string, activitySubType?: string) {
  const [ready, setReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const checkReady = useCallback(() => {
    const el = containerRef.current
    if (!el) return false
    const selector = getReadySelector(activityType, activitySubType)
    const target = el.querySelector(selector)
    if (!target) return false
    // For dynamic content, ensure the editor actually has child nodes (content rendered)
    if (activityType === 'TYPE_DYNAMIC' && target.childNodes.length === 0) return false
    return true
  }, [activityType])

  useEffect(() => {
    if (ready) return

    // Check immediately
    if (checkReady()) {
      setReady(true)
      return
    }

    const el = containerRef.current
    if (!el) return

    const observer = new MutationObserver(() => {
      if (checkReady()) {
        // Wait one frame so the browser has painted the content
        requestAnimationFrame(() => setReady(true))
        observer.disconnect()
      }
    })

    observer.observe(el, { childList: true, subtree: true })

    // Safety timeout — always reveal after 4s regardless
    const timeout = setTimeout(() => {
      setReady(true)
      observer.disconnect()
    }, 4000)

    return () => {
      observer.disconnect()
      clearTimeout(timeout)
    }
  }, [ready, checkReady])

  return { ready, containerRef }
}

function EmbedActivityClient({ activity, course, activityId, orgslug }: EmbedActivityClientProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const showLearnHouseLogo = searchParams.get('showlearnhouselogo') !== 'false'
  const bgColor = searchParams.get('bgcolor')
  const textColor = searchParams.get('textcolor')
  const isEmbeddable = EMBEDDABLE_TYPES.includes(activity.activity_type)
  const { ready, containerRef } = useContentReady(activity.activity_type, activity.activity_sub_type)

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
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') {
          return (
            <Suspense fallback={null}>
              <MarkdownActivity activity={activity} style={customStyles} />
            </Suspense>
          )
        }
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') {
          return (
            <Suspense fallback={null}>
              <EmbedActivity activity={activity} style={customStyles} />
            </Suspense>
          )
        }
        return (
          <EmbedCourseProvider course={course}>
            <Suspense fallback={null}>
              <Canva content={activity.content} activity={activity} hideTableOfContents />
            </Suspense>
          </EmbedCourseProvider>
        )
      case 'TYPE_VIDEO':
        return (
          <Suspense fallback={null}>
            <VideoActivity activity={activity} course={course} />
          </Suspense>
        )
      case 'TYPE_DOCUMENT':
        return (
          <Suspense fallback={null}>
            <DocumentPdfActivity activity={activity} course={course} />
          </Suspense>
        )
      default:
        return null
    }
  }

  const defaultBg = activity.activity_type === 'TYPE_DYNAMIC' ? '#ffffff' : '#09090b'

  const customStyles: React.CSSProperties = {
    backgroundColor: bgColor ? `#${bgColor}` : defaultBg,
    ...(textColor ? { color: `#${textColor}` } : {}),
  }

  return (
    <div className="min-h-screen relative" style={customStyles}>
      <div
        ref={containerRef}
        className="p-4"
        style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.15s ease-in',
        }}
      >
        {renderActivityContent()}
      </div>
      {showLearnHouseLogo && ready && <PoweredByBadge activityUrl={getActivityUrl()} />}
    </div>
  )
}

function PoweredByBadge({ activityUrl }: { activityUrl: string }) {
  const handleClick = () => {
    window.open(activityUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed bottom-4 end-4 z-50">
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
