import { useOrg } from '@components/Contexts/OrgContext'
import { getActivityMediaDirectory } from '@services/media/media'
import { useState, useEffect } from 'react'
import YouTube from 'react-youtube'

function VideoActivity({ activity, course }: { activity: any; course: any }) {
  const org = useOrg() as any
  const [videoId, setVideoId] = useState('')

  useEffect(() => {
    if (activity && activity.content && activity.content.uri) {
      var getYouTubeID = require('get-youtube-id')
      setVideoId(getYouTubeID(activity.content.uri))
    }
  }, [activity, org])

  return (
    <div className="w-full max-w-full px-2 sm:px-4">
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="my-3 w-full md:my-5">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg shadow-xs ring-1 ring-gray-300/30 sm:shadow-none sm:ring-gray-200/10 dark:ring-gray-600/30 sm:dark:ring-gray-700/20">
                <video
                  className="h-full w-full object-cover"
                  controls
                  src={getActivityMediaDirectory(
                    org?.org_uuid,
                    course?.course_uuid,
                    activity.activity_uuid,
                    activity.content?.filename,
                    'video'
                  )}
                ></video>
              </div>
            </div>
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div className="my-3 w-full md:my-5">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg shadow-xs ring-1 ring-gray-300/30 sm:shadow-none sm:ring-gray-200/10 dark:ring-gray-600/30 sm:dark:ring-gray-700/20">
                <YouTube
                  className="h-full w-full"
                  opts={{
                    width: '100%',
                    height: '100%',
                    playerVars: {
                      autoplay: 0,
                    },
                  }}
                  videoId={videoId}
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
