import React from "react";
import YouTube from 'react-youtube';
import { getActivityMediaDirectory } from "@services/media/media";
import { useOrg } from "@components/Contexts/OrgContext";

function VideoActivity({ activity, course }: { activity: any; course: any }) {
  const org = useOrg() as any;
  const [videoId, setVideoId] = React.useState('');

  function getYouTubeEmbed(url: any) {
    // Extract video ID from the YouTube URL
    var videoId = url.match(/(?:\?v=|\/embed\/|\/\d\/|\/vi\/|\/v\/|https?:\/\/(?:www\.)?youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^#\&\?\/]+)/)[1];

    // Create the embed object
    var embedObject = {
      videoId: videoId,
      width: 560,
      height: 315
    };

    return embedObject;
  }


  React.useEffect(() => {
    console.log(activity);
  }, [activity, org]);

  return (
    <div>
      {activity &&
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className="m-8 bg-zinc-900 rounded-md mt-14">
              <video className="rounded-lg w-full h-[500px]" controls
                src={getActivityMediaDirectory(org?.org_uuid, course?.course_uuid, activity.activity_uuid, activity.content?.filename, 'video')}
              ></video>

            </div>
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div>
              <YouTube
                className="rounded-md overflow-hidden m-8 bg-zinc-900  mt-14"
                opts={
                  {
                    width: '1300',
                    height: '500',
                    playerVars: {
                      autoplay: 0,
                    },

                  }
                }
                videoId={videoId} />
            </div>
          )}</>}

    </div>
  );
}




export default VideoActivity;


