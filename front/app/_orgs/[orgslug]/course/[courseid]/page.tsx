"use client";
import { EyeOpenIcon, Pencil2Icon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import styled from "styled-components";
import Layout from "../../../../../components/UI/Layout";
import { getAPIUrl, getBackendUrl } from "../../../../../services/config";
import { getCourse, getCourseMetadata } from "../../../../../services/courses/courses";

const CourseIdPage = (params : any) => {
  const router = useRouter();
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;

  const [isLoading, setIsLoading] = React.useState(true);
  const [courseInfo, setCourseInfo] = React.useState({}) as any;

  async function fetchCourseInfo() {
    const course = await getCourseMetadata("course_" + courseid);

    setCourseInfo(course);


    setIsLoading(false);
  }

  React.useEffect(() => {
    if (courseid && orgslug) {
      fetchCourseInfo();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseid && orgslug]);

  return (
    <Layout>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <CoursePageLayout>
          <br></br>
          <p>Course</p>
          <h1>
            {courseInfo.course.name}{" "}
            <Link
              href={`/org/${orgslug}/course/${courseid}/edit`}
              
              rel="noopener noreferrer">

              <Pencil2Icon />

            </Link>{" "}
          </h1>
          <br />
          <ChaptersWrapper>
            {courseInfo.chapters.map((chapter: any) => {
              return <>
                {chapter.elements.map((element: any) => {
                  return <>
                    <Link href={`/org/${orgslug}/course/${courseid}/element/${element.id.replace("element_", "")}`}>

                      <ChapterIndicator />

                    </Link>{" "}
                  </>;
                })}
                &nbsp;&nbsp;&nbsp;&nbsp;
              </>;
            })}
          </ChaptersWrapper>

          <CourseThumbnailWrapper>
            <img src={`${getBackendUrl()}content/uploads/img/${courseInfo.course.thumbnail}`} alt="" />
          </CourseThumbnailWrapper>

          <h2>Description</h2>
          <p>{courseInfo.course.description}</p>

          <h2>What you will learn</h2>
          <p>{courseInfo.course.learnings == ![] ? "no data" : courseInfo.course.learnings}</p>

          <h2>Course Lessons</h2>

          {courseInfo.chapters.map((chapter: any) => {
            return <>
              <h3>Chapter : {chapter.name}</h3>
              {chapter.elements.map((element: any) => {
                return <>
                  <p>
                    Element {element.name}
                    <Link
                      href={`/org/${orgslug}/course/${courseid}/element/${element.id.replace("element_", "")}`}
                      
                      rel="noopener noreferrer">

                      <EyeOpenIcon />

                    </Link>{" "}
                  </p>
                </>;
              })}
              &nbsp;&nbsp;&nbsp;&nbsp;
            </>;
          })}
        </CoursePageLayout>
      )}
    </Layout>
  );
};

const CourseThumbnailWrapper = styled.div`
  display: flex;
  img {
    width: 794px;
    height: 224.28px;
    object-fit: cover;
    object-position: top;

    background: url(), #d9d9d9;
    border: 1px solid rgba(255, 255, 255, 0.19);
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
  }
`;
const CoursePageLayout = styled.div`
  margin-left: 40px;
  margin-right: 40px;
`;

const ChaptersWrapper = styled.div`
  display: flex;
`;
const ChapterIndicator = styled.div`
  border-radius: 20px;
  height: 5px;
  background: #151515;
  border-radius: 3px;
  width: 40px;
  background-color: black;
  margin: 10px;
  margin-left: 0px;
  transition: all 0.2s ease;

  &:hover {
    width: 50px;
    cursor: pointer;
  }
`;

export default CourseIdPage;
