import { getBackendUrl } from "@services/config/config";
import React from "react";
import styled from "styled-components";

function VideoActivity({ activity, course }: { activity: any; course: any }) {
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

  return (
    <VideoActivityLayout>
      <VideoTitle>
        <p>Chapter : {getChapterName()}</p>
        {activity.name}
      </VideoTitle>
      <VideoPlayerWrapper>
        <video controls src={`${getBackendUrl()}content/uploads/video/${activity.content.video.activity_id}/${activity.content.video.filename}`}></video>
      </VideoPlayerWrapper>
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
