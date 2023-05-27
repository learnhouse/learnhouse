"use client";
import { EyeOpenIcon, Pencil2Icon } from "@radix-ui/react-icons";
import { removeCourse, startCourse } from "@services/courses/activity";
import Link from "next/link";
import React from "react";
import styled from "styled-components";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from "@services/config/config";
import useSWR, { mutate } from "swr";
import ToolTip from "@components/UI/Tooltip/Tooltip";
import PageLoading from "@components/Pages/PageLoading";
import { revalidateTags } from "@services/utils/ts/requests";

const CourseClient = (props: any) => {
  const courseid = props.courseid;
  const orgslug = props.orgslug;
  const course = props.course;

  async function startCourseUI() {
    // Create activity
    await startCourse("course_" + courseid, orgslug);
    revalidateTags(['courses']);
  }

  async function quitCourse() {

    // Close activity
    let activity = await removeCourse("course_" + courseid, orgslug);
    // Mutate course
    revalidateTags(['courses']);
  }

  console.log(course);
  return (
    <>
      {!course ? (
        <PageLoading></PageLoading>
      ) : (
        <CoursePageLayout className="pt-6">
          <p className="text-lg font-bold">Course</p>
          <h1 className="text-3xl font-bold flex items-center space-x-5">
            {course.course.name}{" "}
            <Link href={getUriWithOrg(orgslug, "") + `/course/${courseid}/edit`} rel="noopener noreferrer">
              <Pencil2Icon />
            </Link>{" "}
          </h1>

          <CourseThumbnailWrapper>
            <img src={`${getBackendUrl()}content/uploads/img/${course.course.thumbnail}`} alt="" />
          </CourseThumbnailWrapper>

          <CourseMetaWrapper>
            <CourseMetaLeft>
              <h2 className="py-3 font-bold">Description</h2>

              <BoxWrapper>
                <p className="py-3">{course.course.description}</p>
              </BoxWrapper>

              <h2 className="py-3 font-bold">What you will learn</h2>
              <BoxWrapper>
                <p className="py-3">{course.learnings == ![] ? "no data" : course.learnings}</p>
              </BoxWrapper>

              <h2 className="py-3 font-bold">Course Lessons</h2>

              <BoxWrapper>
                {course.chapters.map((chapter: any) => {
                  return (
                    <div
                      key={chapter}
                      className="py-3"
                    >
                      <h3 className="text-lg">{chapter.name}</h3>
                      <div
                        className="py-3"
                      >{chapter.activities.map((activity: any) => {
                        return (
                          <>
                            <p className="flex text-md">
                              {activity.name}
                              <Link className="pl-3" href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`} rel="noopener noreferrer">
                                <EyeOpenIcon />
                              </Link>{" "}
                            </p>
                          </>
                        );
                      })}</div>
                    </div>
                  );
                })}
              </BoxWrapper>
            </CourseMetaLeft>
            <CourseMetaRight>
              {course.trail.status == "ongoing" ? (
                <button style={{ backgroundColor: "red" }} onClick={quitCourse}>
                  Quit Course
                </button>
              ) : (
                <button onClick={startCourseUI}>Start Course</button>
              )}
            </CourseMetaRight>
          </CourseMetaWrapper>
        </CoursePageLayout>
      )}
    </>
  );
};

const CourseThumbnailWrapper = styled.div`
  display: flex;
  padding-bottom: 20px;
  img {
    width: 100%;
    height: 300px;
    object-fit: cover;
    object-position: center;
    background: url(), #d9d9d9;
    border: 1px solid rgba(255, 255, 255, 0.19);
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
  }
`;
const CoursePageLayout = styled.div`
  width: 1300px;
  margin: 0 auto;
  p {
    margin-bottom: 0px;
    letter-spacing: -0.05em;

    color: #727272;
    font-weight: 700;
  }
  h1 {
    margin-top: 5px;
    letter-spacing: -0.05em;
    margin-bottom: 10px;
  }
`;

const ChaptersWrapper = styled.div`
  display: flex;
  width: 100%;
`;
const CourseIndicator = styled.div< { active?: boolean, done?: boolean } >`
  border-radius: 20px;
  height: 5px;
  background: #151515;
  border-radius: 3px;

  background-color: ${props => props.done ? "green" : "black"};

  width: 40px;
  margin: 10px;
  margin-bottom: 20px;
  margin-left: 0px;

  &:hover {
    cursor: pointer;
    background-color: #9d9d9d;
  }
`;

const ChapterSeparator = styled.div`
  display: flex;
  flex-direction: row;
  padding-right: 7px;
`;

const BoxWrapper = styled.div`
  background: #ffffff;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  border-radius: 7px;
  padding: 20px;
  padding-top: 7px;
  padding-left: 30px;

  p {
    font-family: "DM Sans";
    font-style: normal;
    font-weight: 500;
    line-height: 16px;
    letter-spacing: -0.02em;

    color: #9d9d9d;
  }
`;

const CourseMetaWrapper = styled.div`
  display: flex;
  justify-content: space-between;
`;

const CourseMetaLeft = styled.div`
  width: 80%;
`;

const CourseMetaRight = styled.div`
  background: #ffffff;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  border-radius: 7px;
  padding: 20px;
  width: 30%;
  display: flex;
  height: 100%;
  justify-content: center;
  margin-left: 50px;
  margin-top: 20px;
  button {
    width: 100%;
    height: 50px;
    background: #151515;
    border-radius: 15px;
    border: none;
    color: white;
    font-weight: 700;
    font-family: "DM Sans";
    font-size: 16px;
    letter-spacing: -0.05em;
    transition: all 0.2s ease;
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);

    &:hover {
      cursor: pointer;
      background: #000000;
    }
  }
`;

export default CourseClient;
