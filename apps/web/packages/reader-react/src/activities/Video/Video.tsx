'use client'

import { useMemo } from 'react'
import { useReaderConfig } from '../../Reader/ReaderProvider'
import { getStreamUrl } from '../../services/mediaUrls'
import { stripPrefix } from '../../services/urls'

function youtubeId(uri: string | undefined | null): string | null {
  if (!uri) return null
  const patterns = [
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?(?:.*&)?v=))([\w-]{11})/,
  ]
  for (const re of patterns) {
    const m = uri.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

export interface VideoActivityProps {
  activity: {
    activity_uuid: string
    activity_sub_type: string
    content: { filename?: string; uri?: string }
    details?: {
      startTime?: number
      endTime?: number | null
      autoplay?: boolean
      muted?: boolean
    }
  }
  course: { course_uuid: string }
}

export function VideoActivity({ activity, course }: VideoActivityProps) {
  const { orgUuid, baseApiUrl } = useReaderConfig()

  const ytId = useMemo(
    () => youtubeId(activity?.content?.uri),
    [activity?.content?.uri],
  )

  if (activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED') {
    if (!orgUuid || !activity.content?.filename) return null
    const src = getStreamUrl({
      baseApiUrl,
      orgUuid,
      courseUuid: stripPrefix(course.course_uuid, 'course_'),
      activityUuid: stripPrefix(activity.activity_uuid, 'activity_'),
      filename: activity.content.filename,
      kind: 'activity-video',
    })
    return (
      <div className="w-full max-w-full px-0 sm:px-4">
        <div className="my-0 sm:my-3 md:my-5 w-full">
          <div className="relative w-full aspect-video sm:rounded-lg overflow-hidden">
            <video
              key={activity.activity_uuid}
              src={src}
              controls
              autoPlay={activity.details?.autoplay}
              muted={activity.details?.muted}
              playsInline
              className="w-full h-full"
            />
          </div>
        </div>
      </div>
    )
  }

  if (activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE') {
    if (!ytId) return null
    const params = new URLSearchParams()
    if (activity.details?.autoplay) params.set('autoplay', '1')
    if (activity.details?.muted) params.set('mute', '1')
    if (activity.details?.startTime) params.set('start', String(activity.details.startTime))
    if (activity.details?.endTime) params.set('end', String(activity.details.endTime))
    params.set('rel', '0')
    params.set('modestbranding', '1')
    return (
      <div className="w-full max-w-full px-0 sm:px-4">
        <div className="my-0 sm:my-3 md:my-5 w-full">
          <div className="relative w-full aspect-video sm:rounded-lg overflow-hidden">
            <iframe
              src={`https://www.youtube.com/embed/${ytId}?${params.toString()}`}
              title="YouTube video"
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    )
  }

  return null
}

export default VideoActivity
