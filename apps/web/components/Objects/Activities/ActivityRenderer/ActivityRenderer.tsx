'use client'

import React, { Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { CourseContext, CourseDispatchContext } from '@components/Contexts/CourseContext'
import type { StaticCanvaProps } from '@components/Objects/Activities/StaticCanva/StaticCanva'

// Static render: same blocks as the activity page, no editor instance.
const Canva = lazy(() => import('@components/Objects/Activities/StaticCanva/StaticCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))

/** Activity types that render outside the full course player (embeds, @learnhouse/react). */
export const RENDERABLE_ACTIVITY_TYPES = ['TYPE_DYNAMIC', 'TYPE_VIDEO', 'TYPE_DOCUMENT']

// Minimal course context: courseStructure must be populated so that block
// components (Image, Video, Audio, PDF) can resolve media URLs.
export function StandaloneCourseProvider({ children, course }: { children: ReactNode; course: any }) {
  const minimalState = {
    courseStructure: course,
    courseOrder: null,
    pendingChanges: {},
    unsyncedChanges: {},
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

export interface ActivityRendererProps
  extends Pick<StaticCanvaProps, 'components' | 'marks' | 'hiddenNodes' | 'className'> {
  activity: any
  course: any
  style?: React.CSSProperties
  fallback?: ReactNode
}

/** Renders one activity of any standalone-renderable type, outside the course player. */
export default function ActivityRenderer({ activity, course, style, fallback = null, ...canva }: ActivityRendererProps) {
  const content = (() => {
    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') {
          return <MarkdownActivity activity={activity} style={style} />
        }
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') {
          return <EmbedActivity activity={activity} style={style} />
        }
        return (
          <Canva
            content={activity.content}
            activity={activity}
            courseUuid={course?.course_uuid}
            orgUuid={course?.org_uuid}
            {...canva}
          />
        )
      case 'TYPE_VIDEO':
        return <VideoActivity activity={activity} course={course} />
      case 'TYPE_DOCUMENT':
        return <DocumentPdfActivity activity={activity} course={course} />
      default:
        return null
    }
  })()

  return (
    <StandaloneCourseProvider course={course}>
      <Suspense fallback={fallback}>{content}</Suspense>
    </StandaloneCourseProvider>
  )
}
