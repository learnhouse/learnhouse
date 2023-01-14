"use client";
import { useRouter } from "next/navigation";
import  Link  from "next/link";
import React, { useMemo } from "react";
import Layout from "../../../../../../../components/UI/Layout";
import { getElement } from "../../../../../../../services/courses/elements";
import { getBackendUrl } from "../../../../../../../services/config";
import Canva from "../../../../../../../components/Canva/Canva";
import styled from "styled-components";
import { getCourse, getCourseMetadata } from "../../../../../../../services/courses/courses";


function ElementPage(params: any) {
  const router = useRouter();
  const elementid = params.params.elementid;
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;
  const [element, setElement] = React.useState<any>({});
  const [course, setCourse] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchElementData() {
    setIsLoading(true);
    const element = await getElement("element_" + elementid);
    setElement(element);
  }

  async function fetchCourseData() {
    const course = await getCourseMetadata("course_" + courseid);
    setCourse(course);
    console.log(course);
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (elementid) {
      fetchElementData();
      fetchCourseData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementid]);

  return (
    <>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <LectureLayout>
          <LectureTopWrapper>
            <LectureThumbnail>
              <Link href={`/org/${orgslug}/course/${courseid}`}>
              <img src={`${getBackendUrl()}content/uploads/img/${course.course.thumbnail}`} alt="" />
              </Link>
            </LectureThumbnail>
            <LectureInfo>
              <p>Lecture</p>
              <h1>{element.name}</h1>
            </LectureInfo>
          </LectureTopWrapper>
          <ChaptersWrapper>
            {course.chapters.map((chapter: any) => {
              return (
                <>
                  <div style={{display:"flex" , flexDirection:"row"}}key={chapter.chapter_id}>
                  {chapter.elements.map((element: any) => {
                    return (
                      <>
                        <Link href={`/org/${orgslug}/course/${courseid}/element/${element.id.replace("element_", "")}`}>
                          <ChapterIndicator key={element.id} />
                        </Link>{" "}
                      </>
                    );
                  })}
                  </div>
                  &nbsp;&nbsp;&nbsp;&nbsp;
                </>
              );
            })}
          </ChaptersWrapper>

          <CourseContent>
            {element.type == "dynamic" && <Canva content={element.content} element={element} />}
            {/* todo : use apis & streams instead of this */}
            {element.type == "video" && (
              <video controls src={`${getBackendUrl()}content/uploads/video/${element.content.video.element_id}/${element.content.video.filename}`}></video>
            )}
          </CourseContent>
        </LectureLayout>
      )}
    </>
  );
}

const LectureLayout = styled.div``;

const LectureThumbnail = styled.div`
  padding-right: 30px;
  justify-self: center;
  img {
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
    width: 100px;
    height: 57px;
  }
`;
const LectureInfo = styled.div`
  h1 {
    margin-top: 0px;
  }

  p {
    margin-top: 0;
    margin-bottom: 0;
    font-weight: 700;
  }
`;

const ChaptersWrapper = styled.div`
  display: flex;
  // row 
  flex-direction: row;
  justify-content: space-around;
  width: 100%;
  width: 1300px;
  margin: 0 auto;
`;

const ChapterIndicator = styled.div`
  border-radius: 20px;
  height: 5px;
  background: #151515;
  border-radius: 3px;

  width: 35px;
  background-color: black;
  margin: 10px;
  margin-bottom: 0px;
  margin-left: 0px;
  transition: all 0.2s ease;

  &:hover {
    width: 50px;
    cursor: pointer;
  }
`;

const LectureTopWrapper = styled.div`
  width: 1300px;
  padding-top: 50px;
  margin: 0 auto;
  display: flex;
`;

const CourseContent = styled.div`
  display: flex;
  background-color: white;
  min-height: 600px;
`;
export default ElementPage;
