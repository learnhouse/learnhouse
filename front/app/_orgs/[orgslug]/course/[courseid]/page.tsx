"use client";
import { EyeOpenIcon, Pencil2Icon } from "@radix-ui/react-icons";
import { closeActivity, createActivity } from "@services/courses/activity";
import Link from "next/link";
import React from "react";
import styled from "styled-components";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from "@services/config";
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/requests";

const CourseIdPage = (params: any) => {
  const courseid = params.params.courseid;
  const orgslug = params.params.orgslug;
  const { data: course, error: error } = useSWR(`${getAPIUrl()}courses/meta/course_${courseid}`, swrFetcher);

  async function startActivity() {
    // Create activity
    await createActivity("course_" + courseid);

    // Mutate course
    mutate(`${getAPIUrl()}courses/meta/course_${courseid}`);
  }

  async function quitActivity() {
    // Get activity id and org id
    let activity_id = course.activity.activity_id;
    let org_id = course.activity.org_id;

    // Close activity
    let activity = await closeActivity(activity_id, org_id);
    console.log(activity);

    // Mutate course
    mutate(`${getAPIUrl()}courses/meta/course_${courseid}`);
  }

  return (
    <>
      {error && <p>Failed to load</p>}
      {!course ? (
        <div>Loading...</div>
      ) : (
        <CoursePageLayout>
          <br></br>
          <p>Course</p>
          <h1>
            {course.course.name}{" "}
            <Link href={getUriWithOrg(orgslug,"") +`/course/${courseid}/edit`} rel="noopener noreferrer">
              <Pencil2Icon />
            </Link>{" "}
          </h1>
          <ChaptersWrapper>
            {course.chapters.map((chapter: any) => {
              return (
                <>
                  {chapter.lectures.map((lecture: any) => {
                    return (
                      <>
                        <Link href={getUriWithOrg(orgslug,"") +`/course/${courseid}/lecture/${lecture.id.replace("lecture_", "")}`}>
                          <ChapterIndicator />
                        </Link>{" "}
                      </>
                    );
                  })}
                  &nbsp;&nbsp;&nbsp;&nbsp;
                </>
              );
            })}
          </ChaptersWrapper>

          <CourseThumbnailWrapper>
            <img src={`${getBackendUrl()}content/uploads/img/${course.course.thumbnail}`} alt="" />
          </CourseThumbnailWrapper>

          <CourseMetaWrapper>
            <CourseMetaLeft>
              <h2>Description</h2>

              <BoxWrapper>
                <p>{course.course.description}</p>
              </BoxWrapper>

              <h2>What you will learn</h2>
              <BoxWrapper>
                <p>{course.course.learnings == ![] ? "no data" : course.course.learnings}</p>
              </BoxWrapper>

              <h2>Course Lessons</h2>

              <BoxWrapper>
                {course.chapters.map((chapter: any) => {
                  return (
                    <>
                      <h3>Chapter : {chapter.name}</h3>
                      {chapter.lectures.map((lecture: any) => {
                        return (
                          <>
                            <p>
                              Lecture {lecture.name}
                              <Link href={getUriWithOrg(orgslug,"") +`/course/${courseid}/lecture/${lecture.id.replace("lecture_", "")}`} rel="noopener noreferrer">
                                <EyeOpenIcon />
                              </Link>{" "}
                            </p>
                          </>
                        );
                      })}
                      &nbsp;&nbsp;&nbsp;&nbsp;
                    </>
                  );
                })}
              </BoxWrapper>
            </CourseMetaLeft>
            <CourseMetaRight>
              {course.activity.status == "ongoing" ? (
                <button style={{ backgroundColor: "red" }} onClick={quitActivity}>
                  Quit Activity
                </button>
              ) : (
                <button onClick={startActivity}>Start Activity</button>
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
  justify-content: space-around;
  width: 100%;
`;
const ChapterIndicator = styled.div`
  border-radius: 20px;
  height: 5px;
  background: #151515;
  border-radius: 3px;

  width: 35px;
  background-color: black;
  margin: 10px;
  margin-bottom: 20px;
  margin-left: 0px;
  transition: all 0.2s ease;

  &:hover {
    width: 50px;
    cursor: pointer;
  }
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

export default CourseIdPage;
