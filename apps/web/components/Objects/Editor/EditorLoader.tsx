'use client'
import React from 'react'
import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { useSession } from '@components/Contexts/AuthContext'
import EditorSkeleton from './EditorSkeleton'
import EditorWrapper from './EditorWrapper'
import MarkdownActivity from '@components/Objects/Activities/Markdown/MarkdownActivity'

interface EditorLoaderProps {
  courseid: string
  activityuuid: string
}

/**
 * Single entry point for the editor page. Fetches all data client-side
 * and crossfades from skeleton to editor. No SSR data fetching needed.
 */
export default function EditorLoader({ courseid, activityuuid }: EditorLoaderProps) {
  const session = useSession()
  const access_token = session?.data?.tokens?.access_token
  const [editorReady, setEditorReady] = React.useState(false)

  const { data: courseInfo } = useSWR(
    access_token ? `${getAPIUrl()}courses/course_${courseid}/meta?slim=true` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const { data: activity } = useSWR(
    access_token ? `${getAPIUrl()}activities/activity_${activityuuid}` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const orgUuid = courseInfo?.org_uuid
  const { data: org } = useSWR(
    orgUuid && access_token ? `${getAPIUrl()}orgs/uuid/${orgUuid}` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const dataReady = courseInfo && activity && org
  const isMarkdownActivity = activity?.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN'

  if (isMarkdownActivity && dataReady) {
    return <MarkdownActivity activity={activity} editable />
  }

  return (
    <>
      {/* Skeleton — fades out when editor is ready */}
      <div
        style={{
          opacity: editorReady ? 0 : 1,
          transition: 'opacity 300ms ease-out',
          pointerEvents: editorReady ? 'none' : 'auto',
          position: editorReady ? 'fixed' : 'relative',
          inset: 0,
          zIndex: editorReady ? 50 : 'auto',
        }}
      >
        <EditorSkeleton />
      </div>

      {/* Editor — mounts when data ready, fades in when TipTap initializes */}
      {dataReady && (
        <div
          style={{
            opacity: editorReady ? 1 : 0,
            transition: 'opacity 300ms ease-out',
          }}
        >
          <EditorWrapper
            org={org}
            course={courseInfo}
            activity={activity}
            content={activity.content}
            onEditorReady={() => setEditorReady(true)}
          />
        </div>
      )}
    </>
  )
}
