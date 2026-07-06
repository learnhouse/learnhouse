'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { useAuth } from '@components/Contexts/AuthContext'
import EditorSkeleton from './EditorSkeleton'
import EditorWrapper from './EditorWrapper'
import MarkdownActivity from '@components/Objects/Activities/Markdown/MarkdownActivity'
import EmbedActivity from '@components/Objects/Activities/Embed/EmbedActivity'
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker'

interface EditorLoaderProps {
  courseid: string
  activityuuid: string
}

/**
 * Single entry point for the editor page. Fetches the editor's full bootstrap
 * payload (activity + slim course + org with resolved features) in one request.
 *
 * Uses `useAuth().accessToken` rather than `useSession().data.tokens` so the
 * bootstrap fetch can race the `/users/session` call in parallel: the bare
 * access token is set the moment `/api/auth/refresh` resolves, while
 * `session.data` only populates after the subsequent `/users/session` call.
 */
export default function EditorLoader({ courseid: _courseid, activityuuid }: EditorLoaderProps) {
  const { accessToken: access_token } = useAuth()
  const [editorReady, setEditorReady] = React.useState(false)

  const { data: bootstrap, error: bootstrapError } = useQuery({
    queryKey: queryKeys.activity.editorBootstrap(activityuuid),
    queryFn: () => apiFetch(`${getAPIUrl()}activities/activity_${activityuuid}/editor-bootstrap`, access_token ?? undefined),
    enabled: !!access_token && !!activityuuid,
    staleTime: 60_000,
  })

  const courseInfo = bootstrap?.course
  const activity = bootstrap?.activity
  const org = bootstrap?.org
  const dataReady = Boolean(bootstrap)

  if (bootstrapError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
        <p className="text-sm">Failed to load editor. Please refresh the page.</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-indigo-600 hover:underline"
        >
          Refresh
        </button>
      </div>
    )
  }
  const isMarkdownActivity = activity?.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN'
  const isEmbedActivity = activity?.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED'

  if (isMarkdownActivity && dataReady) {
    return <MarkdownActivity activity={activity} editable />
  }

  if (isEmbedActivity && dataReady) {
    return <EmbedActivity activity={activity} editable />
  }

  return (
    <div className="relative">
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
      <OnboardingTracker />
    </div>
  )
}
