import React from 'react'
import YouTube from 'react-youtube'
import { useOrg } from '@components/Contexts/OrgContext'
import LearnHousePlayer from './LearnHousePlayer'
import { isActivityHlsReady, resolveActivityVideoSource, resolveHlsThumbnails } from './videoSource'

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
}

interface VideoActivityProps {
  activity: {
    activity_sub_type: string
    activity_uuid: string
    content: {
      filename?: string
      uri?: string
    }
    details?: VideoDetails
    extra_metadata?: {
      hls?: {
        status?: string
        thumbnails?: {
          url?: string
          interval?: number
          width?: number
          height?: number
          columns?: number
          rows?: number
        } | null
      }
    } | null
  }
  course: {
    course_uuid: string
  }
  orgUuid?: string
}

function VideoActivity({ activity, course, orgUuid }: VideoActivityProps) {
  const org = useOrg() as any
  const resolvedOrgUuid = orgUuid || org?.org_uuid
  const [videoId, setVideoId] = React.useState('')

  React.useEffect(() => {
    if (activity?.content?.uri) {
      var getYouTubeID = require('get-youtube-id')
      setVideoId(getYouTubeID(activity.content.uri))
    }
  }, [activity, org])

  // Prefer adaptive HLS once transcoding is ready; otherwise fall back to the
  // (optimized) progressive MP4 so playback always works.
  const hlsReady = isActivityHlsReady(activity)

  const getVideoSource = () =>
    resolveActivityVideoSource({
      hlsReady,
      orgUuid: resolvedOrgUuid,
      courseUuid: course?.course_uuid,
      activityUuid: activity.activity_uuid,
      filename: activity.content?.filename,
    })

  return (
    <div className="w-full max-w-full px-0 sm:px-4">
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="my-0 sm:my-3 md:my-5 w-full">
              <div className="relative w-full aspect-video sm:rounded-lg overflow-hidden ring-0 sm:ring-1 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-none">
                {(() => {
                  const { src, isHls } = getVideoSource()
                  const thumbnails = isHls
                    ? resolveHlsThumbnails(activity, {
                        orgUuid: resolvedOrgUuid,
                        courseUuid: course?.course_uuid,
                        activityUuid: activity.activity_uuid,
                      })
                    : null
                  return src ? (
                    <LearnHousePlayer
                      key={src}
                      src={src}
                      isHls={isHls}
                      details={activity.details}
                      thumbnails={thumbnails}
                    />
                  ) : null
                })()}
              </div>
            </div>
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div className="my-0 sm:my-3 md:my-5 w-full">
              <div className="relative w-full aspect-video sm:rounded-lg overflow-hidden ring-0 sm:ring-1 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-none">
                <YouTube
                  className="w-full h-full"
                  opts={{
                    width: '100%',
                    height: '100%',
                    playerVars: {
                      autoplay: activity.details?.autoplay ? 1 : 0,
                      mute: activity.details?.muted ? 1 : 0,
                      start: activity.details?.startTime || 0,
                      end: activity.details?.endTime || undefined,
                      controls: 1,
                      modestbranding: 1,
                      rel: 0
                    },
                  }}
                  videoId={videoId}
                  onReady={(event) => {
                    if (activity.details?.startTime) {
                      event.target.seekTo(activity.details.startTime, true)
                    }
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VideoActivity
