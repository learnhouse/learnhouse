import { getBackendUrl } from "@services/config/config";
import React from "react";
import styled from "styled-components";
import YouTube from 'react-youtube';

function VideoActivity({ activity, course }: { activity: any; course: any }) {
  const [videoId, setVideoId] = React.useState('');
  const [videoType, setVideoType] = React.useState('');

  function getChapterName() {
    let chapterName = "";
    let chapterId = activity.chapter_id;
    course.chapters.forEach((chapter: any) => {
      if (chapter.chapter_id === chapterId) {
        chapterName = chapter.name;
      }
    });
    return chapterName;
  }

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
    if (activity.content.video) {
      setVideoType('video');
    }
    if (activity.content.external_video) {
      setVideoType('external_video');
      setVideoId(getYouTubeEmbed(activity.content.external_video.uri).videoId);
    }
  }, [activity]);

  return (
    <VideoActivityLayout>
      <VideoTitle>
        <p>{getChapterName()}</p>
        <p>{activity.name}</p>
      </VideoTitle>
      {videoType === 'video' && (
        <VideoPlayerWrapper>
          <video controls src={`${getBackendUrl()}content/uploads/video/${activity.content.video.activity_id}/${activity.content.video.filename}`}></video>
        </VideoPlayerWrapper>
      )}
      {videoType === 'external_video' && (
        <VideoPlayerWrapper>
          <YouTube 
          className="rounded-md overflow-hidden"
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
        </VideoPlayerWrapper>
      )}

    </VideoActivityLayout>
  );
}




export default VideoActivity;

const VideoActivityLayout = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: 10px;
  background: #141414;
  min-width: 100%;
  min-height: 1200px;
`;

const VideoTitle = styled.div`
  display: flex;
  width: 1300px;
  margin: 0 auto;
  padding-top: 20px;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  flex-direction: column;

  p {
    font-size: 14px;
    padding: 0;
    margin: 0;
    color: #ffffffaa;
  }
`;

const VideoPlayerWrapper = styled.div`
  display: flex;
  width: 1300px;
  margin: 0 auto;
  justify-content: center;
  padding-top: 20px;

  video {
    width: 1300px;
    height: 500px;
    border-radius: 7px;
    background-color: black;
  }
`;
