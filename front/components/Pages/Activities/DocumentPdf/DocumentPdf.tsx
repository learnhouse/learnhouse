import { getBackendUrl } from "@services/config/config";
import React from "react";
import styled from "styled-components";

function DocumentPdfActivity({ activity, course }: { activity: any; course: any }) {
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
    <DocumentPdfActivityLayout>
      <DocumentPdfTitle>
        <p>Chapter : {getChapterName()}</p>
        {activity.name}
      </DocumentPdfTitle>
      <DocumentPdfPlayerWrapper>
        <iframe
            src={`${getBackendUrl()}content/uploads/documents/documentpdf/${activity.content.documentpdf.activity_id}/${activity.content.documentpdf.filename}`}
          />
      </DocumentPdfPlayerWrapper>
    </DocumentPdfActivityLayout>
  );
}

export default DocumentPdfActivity;

const DocumentPdfActivityLayout = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: 10px;
  background: #141414;
  min-width: 100%;
  min-height: 1200px;
`;

const DocumentPdfTitle = styled.div`
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

const DocumentPdfPlayerWrapper = styled.div`
  display: flex;
  width: 1300px;
  margin: 0 auto;
  justify-content: center;
  padding-top: 20px;

  iframe {
    width: 1300px;
    height: 500px;
    border-radius: 7px;
    background-color: black;
    border: none;
  }
`;
