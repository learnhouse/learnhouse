"use client";
import { EyeOpenIcon, Pencil2Icon } from "@radix-ui/react-icons";
import { removeCourse, startCourse } from "@services/courses/activity";
import Link from "next/link";
import React, { use } from "react";
import styled from "styled-components";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from "@services/config/config";
import useSWR, { mutate } from "swr";
import ToolTip from "@components/StyledElements/Tooltip/Tooltip";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import { revalidateTags } from "@services/utils/ts/requests";
import ActivityIndicators from "@components/Pages/Courses/ActivityIndicators";
import { useRouter } from "next/navigation";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";

const CourseClient = (props: any) => {
  const courseid = props.courseid;
  const orgslug = props.orgslug;
  const course = props.course;
  const router = useRouter();

  async function startCourseUI() {
    // Create activity
    await startCourse("course_" + courseid, orgslug);
    revalidateTags(['courses'], orgslug);
    router.refresh();

    // refresh page (FIX for Next.js BUG)
   // window.location.reload();
  }

  async function quitCourse() {
    // Close activity
    let activity = await removeCourse("course_" + courseid, orgslug);
    // Mutate course
    revalidateTags(['courses'], orgslug);
    router.refresh();

    // refresh page (FIX for Next.js BUG)
    //window.location.reload();
  }


  return (
    <>
      {!course ? (
        <PageLoading></PageLoading>
      ) : (
        <GeneralWrapperStyled>
          <div className="pb-3">
            <p className="text-md font-bold text-gray-400 pb-2">Course</p>
            <h1 className="text-3xl -mt-3 font-bold">
              {course.course.name}
            </h1>
          </div>


          <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-auto h-[300px] bg-cover bg-center mb-4" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(course.course.org_id, course.course.course_id, course.course.thumbnail)})` }}>

          </div>

          <ActivityIndicators course_id={props.course.course.course_id} orgslug={orgslug} course={course} />

          <div className="flex flex-row pt-10 flex-wrap">
            <div className="course_metadata_left grow space-y-2">
              <h2 className="py-3 text-2xl font-bold">Description</h2>
              <StyledBox>
                <p className="py-3">{course.course.description}</p>
              </StyledBox>

              <h2 className="py-3 text-2xl font-bold">What you will learn</h2>
              <StyledBox>

                <p className="py-3">{course.learnings == ![] ? "no data" : course.learnings}</p>
              </StyledBox>

              <h2 className="py-3 text-2xl font-bold">Course Lessons</h2>
              <StyledBox>
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
              </StyledBox>

            </div>
            <div className="course_metadata_right w-64 flex items-center ml-10 h-28 p-3 bg-white rounded-md justify-center drop-shadow-[0_33px_13px_rgba(0,0,0,0.042)] transition-all">
              {course.trail.status == "ongoing" ? (
                <button className="py-2 px-5 rounded-xl text-white font-bold h-12 w-[200px] drop-shadow-md bg-red-600 hover:bg-red-700 hover:cursor-pointer" onClick={quitCourse}>
                  Quit Course
                </button>
              ) : (
                <button className="py-2 px-5 rounded-xl text-white font-bold h-12 w-[200px] drop-shadow-md bg-black hover:bg-gray-900 hover:cursor-pointer" onClick={startCourseUI}>Start Course</button>
              )}
            </div>
          </div>
        </GeneralWrapperStyled>
      )}
    </>
  );
};


const StyledBox = (props: any) => (
  <div className="p-3 pl-10 bg-white rounded-md w-[100%] h-auto drop-shadow-[0_33px_13px_rgba(0,0,0,0.042)]">
    {props.children}
  </div>

);


export default CourseClient;
