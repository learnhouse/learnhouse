import { getBackendUrl } from "@services/config";
import React from "react";
import styled from "styled-components";

function VideoLecture({ lecture, course }: { lecture: any; course: any }) {
  function getChapterName() {
    let chapterName = "";
    let chapterId = lecture.chapter_id;
    course.chapters.forEach((chapter: any) => {
      if (chapter.chapter_id === chapterId) {
        chapterName = chapter.name;
      }
    });
    return chapterName;
  }

  return (
    <VideoLectureLayout>
      <VideoTitle>
        <p>Chapter : {getChapterName()}</p>
        {lecture.name}
      </VideoTitle>
      <VideoPlayerWrapper>
        <video controls src={`${getBackendUrl()}content/uploads/video/${lecture.content.video.lecture_id}/${lecture.content.video.filename}`}></video>
      </VideoPlayerWrapper>
    </VideoLectureLayout>
  );
}

export default VideoLecture;

const VideoLectureLayout = styled.div`
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
