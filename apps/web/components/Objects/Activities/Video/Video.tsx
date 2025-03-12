import React from 'react'
import YouTube from 'react-youtube'
import { getActivityMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'

function VideoActivity({ activity, course }: { activity: any; course: any }) {
  const org = useOrg() as any
  const [videoId, setVideoId] = React.useState('')

  React.useEffect(() => {
    if (activity && activity.content && activity.content.uri) {
      var getYouTubeID = require('get-youtube-id');
      setVideoId(getYouTubeID(activity.content.uri))
    }
  }, [activity, org])

  return (
    <div className="w-full max-w-full px-2 sm:px-4">
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="my-3 md:my-5 w-full">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden ring-1 ring-gray-300/30 dark:ring-gray-600/30 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-xs sm:shadow-none">
                <video
                  className="w-full h-full object-cover"
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
            <div className="my-3 md:my-5 w-full">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden ring-1 ring-gray-300/30 dark:ring-gray-600/30 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-xs sm:shadow-none">
                <YouTube
                  className="w-full h-full"
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
