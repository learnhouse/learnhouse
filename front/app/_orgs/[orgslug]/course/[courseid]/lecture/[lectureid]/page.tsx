"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import React, { useMemo } from "react";
import Layout from "@components/UI/Layout";
import { getLecture } from "@services/courses/lectures";
import { getBackendUrl } from "@services/config";
import Canva from "@components/LectureViews/DynamicCanva/DynamicCanva";
import styled from "styled-components";
import { getCourse } from "@services/courses/courses";
import VideoLecture from "@components/LectureViews/Video/Video";
import { Check } from "lucide-react";
import { maskLectureAsComplete } from "@services/courses/activity";

function LecturePage(params: any) {
  const router = useRouter();
  const lectureid = params.params.lectureid;
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;
  const [lecture, setLecture] = React.useState<any>({});
  const [course, setCourse] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchLectureData() {
    setIsLoading(true);
    const lecture = await getLecture("lecture_" + lectureid);
    setLecture(lecture);
  }

  async function fetchCourseData() {
    const course = await getCourseMetadata("course_" + courseid);
    setCourse(course);
    setIsLoading(false);
  }

  async function markLectureAsCompleteFront() {
    const activity = await maskLectureAsComplete("" + lectureid, courseid, lecture.lecture_id.replace("lecture_", ""));
    fetchCourseData();
  }

  React.useEffect(() => {
    if (lectureid) {
      fetchLectureData();
      fetchCourseData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureid]);

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
              <p>Course</p>
              <h1>{course.course.name}</h1>
            </LectureInfo>
          </LectureTopWrapper>
          <ChaptersWrapper>
            {course.chapters.map((chapter: any) => {
              return (
                <>
                  <div style={{ display: "flex", flexDirection: "row" }} key={chapter.chapter_id}>
                    {chapter.lectures.map((lecture: any) => {
                      return (
                        <>
                          <Link href={`/org/${orgslug}/course/${courseid}/lecture/${lecture.id.replace("lecture_", "")}`}>
                            <ChapterIndicator key={lecture.id} />
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
            {lecture.type == "dynamic" && <Canva content={lecture.content} lecture={lecture} />}
            {/* todo : use apis & streams instead of this */}
            {lecture.type == "video" && <VideoLecture course={course} lecture={lecture} />}

            <ActivityMarkerWrapper>
              {course.activity.lectures_marked_complete.includes("lecture_"+lectureid) && course.activity.status == "ongoing" ? (
                <button style={{ backgroundColor: "green" }}>
                  <i>
                    <Check size={20}></Check>
                  </i>{" "}
                  Already completed
                </button>
              ) : (
                <button onClick={markLectureAsCompleteFront}>
                  {" "}
                  <i>
                    <Check size={20}></Check>
                  </i>{" "}
                  Mark as complete
                </button>
              )}
            </ActivityMarkerWrapper>
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
  flex-direction: column;
  background-color: white;
  min-height: 600px;
`;

const ActivityMarkerWrapper = styled.div`
  display: block;
  width: 1300px;
  justify-content: flex-end;
  margin: 0 auto;
  align-items: center;

  button {
    background-color: #151515;
    border: none;
    padding: 18px;
    border-radius: 15px;
    margin: 15px;
    margin-left: 20px;
    margin-top: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: auto;
    color: white;
    font-weight: 700;
    font-family: "DM Sans";
    font-size: 16px;
    letter-spacing: -0.05em;
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);

    i {
      margin-right: 5px;

      // center the icon
      display: flex;
      align-items: center;
      justify-content: center;
    }

    &:hover {
      background-color: #000000;
    }
  }
`;

export default LecturePage;
