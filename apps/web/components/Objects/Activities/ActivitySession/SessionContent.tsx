'use client'

// The activity itself, rendered by the same components the lesson page uses
// for each kind (activity.tsx `activityContent`), lazily loaded the same way.

import React, { Suspense, lazy } from 'react'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'

const Canva = lazy(() => import('@components/Objects/Activities/DynamicCanva/DynamicCanva'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const AssignmentStudentActivity = lazy(() => import('@components/Objects/Activities/Assignment/AssignmentStudentActivity'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))
const ResourceActivity = lazy(() => import('@components/Objects/Activities/Resource/ResourceActivity'))
const ScormActivity = lazy(() => import('@ee/components/Activities/ScormActivity'))
const LiveSessionActivity = lazy(() => import('@ee/components/LiveSessions/LiveSessionActivity'))
const PlayActivity = lazy(() => import('@ee/components/Plays/course/PlayActivity'))

export function SessionSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-1" aria-hidden>
      <div className="h-6 w-2/5 rounded-md bg-neutral-100" />
      <div className="h-3.5 w-full rounded bg-neutral-100" />
      <div className="h-3.5 w-[92%] rounded bg-neutral-100" />
      <div className="h-3.5 w-[86%] rounded bg-neutral-100" />
      <div className="h-24 w-full rounded-xl bg-neutral-100" />
    </div>
  )
}

/** Where the kind sits: a white page, or a dark stage (players, documents). */
export function surfaceOf(activity: any): 'page' | 'stage' | 'bare' {
  switch (activity?.activity_type) {
    case 'TYPE_DYNAMIC':
    case 'TYPE_SCORM':
      return 'page'
    case 'TYPE_DOCUMENT':
      return 'stage'
    default:
      return 'bare'
  }
}

export default function SessionContent({ activity, course, orgslug, orgUuid, assignment }: { activity: any; course: any; orgslug: string; orgUuid?: string; assignment: any }) {
  const node = (() => {
    switch (activity.activity_type) {
      case 'TYPE_DYNAMIC':
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') return <MarkdownActivity activity={activity} />
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') return <EmbedActivity activity={activity} />
        if (activity.activity_sub_type === 'SUBTYPE_DYNAMIC_RESOURCE') return <ResourceActivity activity={activity} orgslug={orgslug} />
        return <Canva content={activity.content} activity={activity} courseUuid={course?.course_uuid} orgUuid={orgUuid} />
      case 'TYPE_VIDEO':
        return <VideoActivity course={course} activity={activity} orgUuid={orgUuid} />
      case 'TYPE_DOCUMENT':
        return <DocumentPdfActivity course={course} activity={activity} />
      case 'TYPE_ASSIGNMENT':
        return assignment ? (
          <AssignmentSubmissionProvider assignment_uuid={assignment.assignment_uuid}>
            <AssignmentProvider assignment_uuid={assignment.assignment_uuid}>
              <AssignmentsTaskProvider>
                <AssignmentStudentActivity />
              </AssignmentsTaskProvider>
            </AssignmentProvider>
          </AssignmentSubmissionProvider>
        ) : (
          <SessionSkeleton />
        )
      case 'TYPE_SCORM':
        return <ScormActivity course={course} activity={activity} />
      case 'TYPE_LIVE_SESSION':
        return <LiveSessionActivity activity={activity} orgslug={orgslug} />
      case 'TYPE_PLAY':
        return <PlayActivity activity={activity} course={course} orgslug={orgslug} />
      default:
        return null
    }
  })()
  return <Suspense fallback={<SessionSkeleton />}>{node}</Suspense>
}
