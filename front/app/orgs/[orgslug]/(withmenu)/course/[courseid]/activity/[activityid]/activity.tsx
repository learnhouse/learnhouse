"use client";
import Link from "next/link";
import React, { useMemo } from "react";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from "@services/config/config";
import Canva from "@components/Pages/Activities/DynamicCanva/DynamicCanva";
import styled from "styled-components";
import VideoActivity from "@components/Pages/Activities/Video/Video";
import useSWR, { mutate } from "swr";
import { Check } from "lucide-react";
import { markActivityAsComplete } from "@services/courses/activity";
import ToolTip from "@components/UI/Tooltip/Tooltip";
import DocumentPdfActivity from "@components/Pages/Activities/DocumentPdf/DocumentPdf";

interface ActivityClientProps {
  activityid: string;
  courseid: string;
  orgslug: string;
  activity: any;
  course: any;
}

function ActivityClient(props: ActivityClientProps) {
  const activityid = props.activityid;
  const courseid = props.courseid;
  const orgslug = props.orgslug;
  const activity = props.activity;
  const course = props.course;


  async function markActivityAsCompleteFront() {
    const trail = await markActivityAsComplete(orgslug, courseid, activityid);
    mutate(`${getAPIUrl()}activities/activity_${activityid}`);
    mutate(`${getAPIUrl()}courses/meta/course_${courseid}`);
  }

  return (
    <>
      <ActivityLayout>
          <pre style={{ display: "none" }}>{JSON.stringify(activity, null, 2)}</pre>
          <ActivityTopWrapper>
            <ActivityThumbnail>
              <Link href={getUriWithOrg(orgslug, "") + `/course/${courseid}`}>
                <img src={`${getBackendUrl()}content/uploads/img/${course.course.thumbnail}`} alt="" />
              </Link>
            </ActivityThumbnail>
            <ActivityInfo>
              <p>Course</p>
              <h1>{course.course.name}</h1>
            </ActivityInfo>
          </ActivityTopWrapper>
          <ChaptersWrapper>
            {course.chapters.map((chapter: any) => {
              return (
                <>
                  <div style={{ display: "flex", flexDirection: "row" }} key={chapter.chapter_id}>
                    {chapter.activities.map((activity: any) => {
                      return (
                        <ToolTip sideOffset={-5} slateBlack content={activity.name} key={activity.id}>
                          <Link href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`}>
                            <ChapterIndicator
                              done={course.trail.activities_marked_complete && course.trail.activities_marked_complete.includes(activity.id) && course.trail.status == "ongoing"}
                              active={"activity_" + activityid === activity.id ? true : false} key={activity.id}
                            />
                          </Link>
                        </ToolTip>
                      );
                    })}
                  </div>
                  &nbsp;&nbsp;&nbsp;&nbsp;
                </>
              );
            })}
          </ChaptersWrapper>

          {activity ? (
            <CourseContent>
              {activity.type == "dynamic" && <Canva content={activity.content} activity={activity} />}
              {/* todo : use apis & streams instead of this */}
              {activity.type == "video" && <VideoActivity course={course} activity={activity} />}

              {activity.type == "documentpdf" && <DocumentPdfActivity course={course} activity={activity} />}

              <ActivityMarkerWrapper className="py-10">

                {course.trail.activities_marked_complete &&
                  course.trail.activities_marked_complete.includes("activity_" + activityid) &&
                  course.trail.status == "ongoing" ? (
                  <button style={{ backgroundColor: "green" }}>
                    <i>
                      <Check size={20}></Check>
                    </i>{" "}
                    Already completed
                  </button>
                ) : (
                  <button onClick={markActivityAsCompleteFront}>
                    {" "}
                    <i>
                      <Check size={20}></Check>
                    </i>{" "}
                    Mark as complete
                  </button>
                )}
              </ActivityMarkerWrapper>
            </CourseContent>
          ) : (<div></div>)}
          {<div style={{ height: "100px" }}></div>}
        </ActivityLayout>
    </>
  );
}

const ActivityLayout = styled.div``;

const ActivityThumbnail = styled.div`
  padding-right: 30px;
  justify-self: center;
  img {
    box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.42);
    border-radius: 7px;
    width: 100px;
    height: 57px;
  }
`;
const ActivityInfo = styled.div`
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
  width: 100%;
  width: 1300px;
  margin: 0 auto;
`;

const ChapterIndicator = styled.div < { active?: boolean, done?: boolean } > `
  border-radius: 20px;
  height: 5px;
  background: #151515;
  border-radius: 3px;

  width: 35px;
  background-color: ${props => props.done ? "green" : (props.active ? "#9d9d9d" : "black")};
  margin: 10px;
  margin-bottom: 0px;
  margin-left: 0px;

  &:hover {
    cursor: pointer;
    background-color: #9d9d9d;
  }
`;

const ActivityTopWrapper = styled.div`
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

export default ActivityClient;
