import { getBackendUrl } from "@services/config/config";
import React from "react";
import styled from "styled-components";
import YouTube from 'react-youtube';
import { getActivityMediaDirectory } from "@services/media/media";

function VideoActivity({ activity, course }: { activity: any; course: any }) {
  const [videoId, setVideoId] = React.useState('');
  const [videoType, setVideoType] = React.useState('');

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
    if (activity.content.video) {
      setVideoType('video');
    }
    if (activity.content.external_video) {
      setVideoType('external_video');
      setVideoId(getYouTubeEmbed(activity.content.external_video.uri).videoId);
    }
  }, [activity]);

  return (
    <div>
      {videoType === 'video' && (
        <div className="m-8 bg-zinc-900 rounded-md mt-14">
          <video className="rounded-lg w-full h-[500px]" controls
            src={getActivityMediaDirectory(activity.org_id, activity.course_uuid, activity.activity_id, activity.content.video.filename, 'video')}
          ></video>

        </div>
      )}
      {videoType === 'external_video' && (
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
      )}

    </div>
  );
}




export default VideoActivity;


