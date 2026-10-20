import React from 'react'
import YouTube from 'react-youtube'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import LearnHousePlayer, { type PlayerNavItem } from './LearnHousePlayer'
import VideoChapters from './VideoChapters'
import { positiveIntParam } from '@/lib/copilot/sources'
import {
  isActivityHlsReady,
  resolveActivityVideoSource,
  resolveHlsThumbnails,
  resolveActivityCaptions,
  resolveActivityChapters,
  resolveAdjacentActivities,
  spriteFrameStyle,
} from './videoSource'

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
}

interface NeighborActivity {
  activity_uuid?: string
  name?: string
  published?: boolean
  activity_type?: string
  extra_metadata?: VideoActivityProps['activity']['extra_metadata']
}

interface VideoActivityProps {
  activity: {
    name?: string
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
      captions?: {
        enabled?: boolean
        languages?: { code?: string; label?: string; status?: string }[]
      } | null
      chapters?: { status?: string; items?: { start?: unknown; title?: unknown }[] } | null
    } | null
  }
  course: {
    course_uuid: string
    name?: string
    thumbnail_image?: string
    chapters?: { activities?: NeighborActivity[] }[]
  }
  orgUuid?: string
}

function VideoActivity({ activity, course, orgUuid }: VideoActivityProps) {
  const org = useOrg() as any
  const router = useRouter()
  const { t } = useTranslation()
  const [videoEl, setVideoEl] = React.useState<HTMLVideoElement | null>(null)
  const chapters = React.useMemo(() => resolveActivityChapters(activity), [activity])
  const resolvedOrgUuid = orgUuid || org?.org_uuid
  const [videoId, setVideoId] = React.useState('')
  // `?t=<seconds>` opens the video at a moment, e.g. from a copilot citation.
  // The player reads its start time when it initializes on the client; no
  // markup depends on it, so reading the URL during render is hydration-safe.
  const linkedStart = typeof window !== 'undefined' ? positiveIntParam(window.location.search, 't') : null
  const details = linkedStart ? { ...activity.details, startTime: linkedStart } : activity.details

  React.useEffect(() => {
    if (activity?.content?.uri) {
      var getYouTubeID = require('get-youtube-id')
      setVideoId(getYouTubeID(activity.content.uri))
    }
  }, [activity, org])

  // Prefer adaptive HLS once transcoding is ready; otherwise fall back to the
  // (optimized) progressive MP4 so playback always works.
  const hlsReady = isActivityHlsReady(activity)

  // Previous / next activities for the paused screen. Video neighbours show a
  // frame from their storyboard; anything else falls back to the course
  // thumbnail.
  const { prevItem, nextItem } = React.useMemo(() => {
    const cleanCourse = course?.course_uuid?.replace('course_', '')
    const base = getUriWithOrg(org?.slug, '') + `/course/${cleanCourse}/activity/`
    const courseThumb = course?.thumbnail_image
      ? getCourseThumbnailMediaDirectory(resolvedOrgUuid, course.course_uuid, course.thumbnail_image)
      : null
    const toItem = (a: NeighborActivity, label: string): PlayerNavItem => {
      const sprite = isActivityHlsReady(a)
        ? resolveHlsThumbnails(a, {
            orgUuid: resolvedOrgUuid,
            courseUuid: course?.course_uuid,
            activityUuid: a.activity_uuid || '',
          })
        : null
      return {
        label,
        title: a.name || '',
        previewStyle: sprite ? spriteFrameStyle(sprite) : null,
        imageUrl: courseThumb,
        onSelect: () => router.push(base + (a.activity_uuid || '').replace('activity_', '')),
      }
    }
    const { prev, next } = resolveAdjacentActivities(course, activity.activity_uuid)
    return {
      prevItem: prev ? toItem(prev, t('common.previous')) : null,
      nextItem: next
        ? toItem(next, t('common.next'))
        : {
            label: t('course.finish_course', 'Finish course'),
            title: course?.name || '',
            imageUrl: courseThumb,
            onSelect: () => router.push(base + 'end'),
          },
    }
  }, [course, activity.activity_uuid, org?.slug, resolvedOrgUuid, router, t])

  const getVideoSource = () =>
    resolveActivityVideoSource({
      hlsReady,
      orgUuid: resolvedOrgUuid,
      courseUuid: course?.course_uuid,
      activityUuid: activity.activity_uuid,
      filename: activity.content?.filename,
    })

  return (
    <div className="w-full max-w-full">
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="w-full">
              <div className="relative w-full aspect-video">
                {(() => {
                  const { src, isHls } = getVideoSource()
                  const thumbnails = isHls
                    ? resolveHlsThumbnails(activity, {
                        orgUuid: resolvedOrgUuid,
                        courseUuid: course?.course_uuid,
                        activityUuid: activity.activity_uuid,
                      })
                    : null
                  // Always compute the progressive MP4 URL so the player can fall
                  // back to it if the HLS source errors (partial/broken transcode).
                  const fallbackSrc = isHls
                    ? resolveActivityVideoSource({
                        hlsReady: false,
                        orgUuid: resolvedOrgUuid,
                        courseUuid: course?.course_uuid,
                        activityUuid: activity.activity_uuid,
                        filename: activity.content?.filename,
                      }).src
                    : undefined
                  // Ready AI caption tracks attach to either source (HLS or MP4).
                  const captions = resolveActivityCaptions(activity, {
                    orgUuid: resolvedOrgUuid,
                    courseUuid: course?.course_uuid,
                    activityUuid: activity.activity_uuid,
                  })
                  return src ? (
                    <LearnHousePlayer
                      key={src}
                      src={src}
                      title={activity.name}
                      ambient
                      prevItem={prevItem}
                      nextItem={nextItem}
                      isHls={isHls}
                      fallbackSrc={fallbackSrc}
                      details={details}
                      thumbnails={thumbnails}
                      captions={captions}
                      chapters={chapters}
                      onVideoElement={setVideoEl}
                    />
                  ) : null
                })()}
              </div>
              {chapters.length > 0 && (
                <VideoChapters
                  chapters={chapters}
                  video={videoEl}
                  heading={t('activities.video_chapters', 'Chapters')}
                  thumbnails={
                    hlsReady
                      ? resolveHlsThumbnails(activity, {
                          orgUuid: resolvedOrgUuid,
                          courseUuid: course?.course_uuid,
                          activityUuid: activity.activity_uuid,
                        })
                      : null
                  }
                />
              )}
            </div>
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div className="w-full">
              <div className="relative w-full aspect-video overflow-hidden rounded-[20px] ring-1 ring-white/10">
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
