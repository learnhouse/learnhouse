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
    <div>
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="m-8 bg-zinc-900 rounded-md mt-14">
              <video
                className="rounded-lg w-full h-[500px]"
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
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div>
              <YouTube
                className="rounded-md overflow-hidden m-8 bg-zinc-900  mt-14"
                opts={{
                  width: '1300',
                  height: '500',
                  playerVars: {
                    autoplay: 0,
                  },
                }}
                videoId={videoId}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VideoActivity
