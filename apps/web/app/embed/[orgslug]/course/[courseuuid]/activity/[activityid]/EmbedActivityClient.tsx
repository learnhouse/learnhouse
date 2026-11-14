'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'next/navigation'
import { getLEARNHOUSE_DOMAIN_VAL, getLEARNHOUSE_HTTP_PROTOCOL_VAL } from '@services/config/config'
import Image from 'next/image'
import { useActivity } from '@/hooks/queries/useActivity'
import { useCourseMeta } from '@/hooks/queries/useCourses'
import { useShowLearnHouseBranding } from '@components/Hooks/useLearnHouseBranding'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { TranslationFallbackNotice, contentLangProps } from '@components/Objects/Courses/ContentLanguage/ContentLanguage'
import { servedLocale, showsTranslationFallback } from '@/lib/contentLanguage'
import { normalizeRequest } from '@components/Objects/Activities/BlockTheme/blockTheme'
import ActivityRenderer, { RENDERABLE_ACTIVITY_TYPES } from '@components/Objects/Activities/ActivityRenderer/ActivityRenderer'
import { parseEmbedOptions } from '@/lib/embed/protocol'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import { useEmbedBridge, useEmbedUnavailable } from './useEmbedBridge'

interface EmbedActivityClientProps {
  activityId: string
  courseuuid: string
  orgslug: string
}

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

    // Safety timeout: always reveal after 1.5s regardless
    const timeout = setTimeout(() => {
      setReady(true)
      observer.disconnect()
    }, 1500)

    return () => {
      observer.disconnect()
      clearTimeout(timeout)
    }
  }, [ready, checkReady])

  return { ready, containerRef }
}

function EmbedActivityClient({ activityId, courseuuid, orgslug }: EmbedActivityClientProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const options = parseEmbedOptions(searchParams, SUPPORTED_LANGUAGES)
  const showBranding = useShowLearnHouseBranding()
  const showLearnHouseLogo = showBranding && options.showLogo
  const endRef = useRef<HTMLDivElement>(null)
  // ?theme=light|dark forces the block theme; anything else follows bgcolor.
  const blockTheme = normalizeRequest(searchParams.get('theme'))

  // Same content language resolution as the course pages (`?lang=` on the
  // embed URL, remembered choice, UI language, browser).
  const contentLang = useContentLanguage()
  const langOpts = { lang: contentLang.lang || undefined, enabled: contentLang.ready }
  const { data: activity, isLoading: activityLoading } = useActivity(activityId, langOpts)
  const { data: course, isLoading: courseLoading } = useCourseMeta(courseuuid, langOpts)

  const isLoading = activityLoading || courseLoading || (!contentLang.ready && !activity)
  const { ready, containerRef } = useContentReady(
    activity?.activity_type ?? '',
    activity?.activity_sub_type,
  )
  useEmbedBridge({ activityId, ready, containerRef, endRef })

  const unavailable =
    !isLoading &&
    (!activity ||
      activity.detail === 'Not Found' ||
      !course ||
      course.detail === 'Not Found' ||
      !activity.published ||
      !RENDERABLE_ACTIVITY_TYPES.includes(activity.activity_type))
  useEmbedUnavailable(activityId, unavailable)

  const getActivityUrl = () => {
    const cleanCourseUuid = (course?.course_uuid ?? courseuuid).replace('course_', '')
    const path = `/course/${cleanCourseUuid}/activity/${activityId}`
    // Always build an absolute org URL: the embed may be served from the main app domain
    // (e.g. app.learnhouse.io), so a relative path would resolve to the wrong host.
    if (typeof window !== 'undefined' && orgslug) {
      const domain = getLEARNHOUSE_DOMAIN_VAL()
      const protocol = getLEARNHOUSE_HTTP_PROTOCOL_VAL()
      if (domain && domain !== 'localhost') {
        return `${protocol}${orgslug}.${domain}${path}`
      }
    }
    return path
  }

  if (isLoading) {
    return <div className="min-h-screen" />
  }

  if (!activity || activity.detail === 'Not Found' || !course || course.detail === 'Not Found') {
    return null
  }

  if (!activity.published) {
    return null
  }

  const isEmbeddable = RENDERABLE_ACTIVITY_TYPES.includes(activity.activity_type)

  if (!isEmbeddable) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8">
        <div className="bg-white rounded-2xl nice-shadow p-8 max-w-md w-full text-center">
          {showBranding && (
            <div className="mb-6">
              <Image
                src="/learnhouse_bigicon.png"
                alt="LearnHouse"
                width={64}
                height={64}
                className="mx-auto"
              />
            </div>
          )}
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

  const defaultBg = activity.activity_type === 'TYPE_DYNAMIC' ? '#ffffff' : '#09090b'

  const customStyles: React.CSSProperties = {
    backgroundColor: options.bgcolor ?? defaultBg,
    // Prevent browser auto-dark-mode from inverting text inside the embed container
    colorScheme: 'light',
    ...(options.textcolor
      ? { color: options.textcolor }
      : activity.activity_type === 'TYPE_DYNAMIC'
        ? { color: '#000000' }
        : {}),
  }

  return (
    <div className="min-h-screen relative" style={customStyles}>
      <div
        ref={containerRef}
        {...(activity.locale ? contentLangProps(activity.locale) : {})}
        style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.15s ease-in',
        }}
      >
        {showsTranslationFallback(activity, course) && (
          <TranslationFallbackNotice locale={servedLocale(course)} className="m-3" />
        )}
        <ActivityRenderer activity={activity} course={course} style={customStyles} theme={blockTheme} />
        {/* Reaching this marks the activity complete for the host page. */}
        <div ref={endRef} aria-hidden style={{ height: 1 }} />
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
