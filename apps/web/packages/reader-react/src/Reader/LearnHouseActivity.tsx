'use client'

import { Suspense, type CSSProperties } from 'react'
import { useActivity } from '../hooks/useActivity'
import { useCourseMeta } from '../hooks/useCourseMeta'
import { useReaderConfig } from './ReaderProvider'
import { PoweredByBadge } from './PoweredByBadge'
import {
  activityIdWithPrefix,
  courseUuidWithPrefix,
  stripPrefix,
} from '../services/urls'
import { ReadOnlyCourseProvider } from '../contexts/CourseContext'
import DynamicCanva from '../activities/DynamicCanva/DynamicCanva'
import VideoActivity from '../activities/Video/Video'
import DocumentPdfActivity from '../activities/DocumentPdf/DocumentPdf'
import MarkdownActivity from '../activities/Markdown/Markdown'
import EmbedActivity from '../activities/Embed/Embed'

export interface LearnHouseActivityProps {
  activityId: string
  courseUuid: string
  /** Hex color (no `#`) for the reader background. */
  bgcolor?: string
  /** Hex color (no `#`) for the reader text. */
  textcolor?: string
}

const EMBEDDABLE_TYPES = new Set(['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT'])

const HEX_RE = /^[0-9a-fA-F]{3,8}$/

function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null
  const stripped = input.startsWith('#') ? input.slice(1) : input
  return HEX_RE.test(stripped) ? `#${stripped}` : null
}

export function LearnHouseActivity({
  activityId,
  courseUuid,
  bgcolor,
  textcolor,
}: LearnHouseActivityProps) {
  const { orgSlug, showPoweredBy, buildActivityUrl } = useReaderConfig()
  const { data: activity, isLoading: activityLoading } = useActivity(activityId)
  const { data: course, isLoading: courseLoading } = useCourseMeta(courseUuid)

  const isLoading = activityLoading || courseLoading

  const cleanCourseUuid = stripPrefix(
    course?.course_uuid ?? courseUuidWithPrefix(courseUuid),
    'course_',
  )
  const cleanActivityId = stripPrefix(
    activity?.activity_uuid ?? activityIdWithPrefix(activityId),
    'activity_',
  )
  const activityUrl =
    buildActivityUrl?.({ orgSlug, courseUuid: cleanCourseUuid, activityId: cleanActivityId }) ??
    `/course/${cleanCourseUuid}/activity/${cleanActivityId}`

  if (isLoading) return <div className="min-h-screen" />
  if (!activity || activity.detail === 'Not Found') return null
  if (!course || course.detail === 'Not Found') return null
  if (!activity.published) return null

  const isEmbeddable = EMBEDDABLE_TYPES.has(activity.activity_type)
  const defaultBg = activity.activity_type === 'TYPE_DYNAMIC' ? '#ffffff' : '#09090b'
  const normalizedBg = normalizeHex(bgcolor)
  const normalizedText = normalizeHex(textcolor)
  const containerStyle: CSSProperties = {
    backgroundColor: normalizedBg ?? defaultBg,
    colorScheme: 'light',
    ...(normalizedText
      ? { color: normalizedText }
      : activity.activity_type === 'TYPE_DYNAMIC'
        ? { color: '#000000' }
        : {}),
  }

  if (!isEmbeddable) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8" style={containerStyle}>
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow">
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            This activity isn't available in the reader yet
          </h1>
          <p className="text-gray-600 mb-6">
            Open it in LearnHouse to view it.
          </p>
          <a
            href={activityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-gray-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Open in LearnHouse
          </a>
        </div>
        {showPoweredBy && <PoweredByBadge href={activityUrl} />}
      </div>
    )
  }

  const bodyStyle: CSSProperties | undefined = bgcolor || textcolor ? containerStyle : undefined

  return (
    <div className="min-h-screen relative" style={containerStyle}>
      <Suspense fallback={null}>
        {renderActivity(activity, course, bodyStyle)}
      </Suspense>
      {showPoweredBy && <PoweredByBadge href={activityUrl} />}
    </div>
  )
}

function renderActivity(activity: any, course: any, style?: CSSProperties) {
  switch (activity.activity_type) {
    case 'TYPE_DYNAMIC':
      if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') {
        return <MarkdownActivity activity={activity} style={style} />
      }
      if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') {
        return <EmbedActivity activity={activity} style={style} />
      }
      return (
        <ReadOnlyCourseProvider course={course}>
          <DynamicCanva content={activity.content} activity={activity} hideTableOfContents />
        </ReadOnlyCourseProvider>
      )
    case 'TYPE_VIDEO':
      return <VideoActivity activity={activity} course={course} />
    case 'TYPE_DOCUMENT':
      return <DocumentPdfActivity activity={activity} course={course} />
    default:
      return null
  }
}
