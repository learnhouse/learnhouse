"use client";
import { removeCourse, startCourse } from "@services/courses/activity";
import Link from "next/link";
import React, { use, useEffect, useState } from "react";
import { getUriWithOrg } from "@services/config/config";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import { revalidateTags } from "@services/utils/ts/requests";
import ActivityIndicators from "@components/Pages/Courses/ActivityIndicators";
import { useRouter } from "next/navigation";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";
import { ArrowRight, Check, File, Sparkles, Star, Video } from "lucide-react";
import Avvvatars from "avvvatars-react";
import { getUser } from "@services/users/users";

const CourseClient = (props: any) => {
  const [user, setUser] = useState<any>({});
  const courseid = props.courseid;
  const orgslug = props.orgslug;
  const course = props.course;
  const router = useRouter();



  async function getUserUI() {
    let user_id = course.course.authors[0];
    const user = await getUser(user_id);
    setUser(user);
    console.log(user);
  }

  async function startCourseUI() {
    // Create activity
    await startCourse("course_" + courseid, orgslug);
    await revalidateTags(['courses'], orgslug);
    router.refresh();

    // refresh page (FIX for Next.js BUG)
    // window.location.reload();
  }

  async function quitCourse() {
    // Close activity
    let activity = await removeCourse("course_" + courseid, orgslug);
    // Mutate course
    await revalidateTags(['courses'], orgslug);
    router.refresh();
  }

    useEffect(() => {
      getUserUI();
    }
    , []);

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

          <div className="flex flex-row pt-10">
            <div className="course_metadata_left grow space-y-2">
              <h2 className="py-3 text-2xl font-bold">Description</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                <p className="py-5 px-5">{course.course.description}</p>
              </div>

              <h2 className="py-3 text-2xl font-bold">What you will learn</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden px-5 py-5 space-y-2">
                {course.course.learnings.map((learning: any) => {
                  return (
                    <div key={learning}
                      className="flex space-x-2 items-center font-semibold text-gray-500 capitalize">
                      <div className="px-2 py-2 rounded-full">
                        <Check className="text-gray-400" size={15} />
                      </div>
                      <p>{learning}</p>
                    </div>
                  );
                }
                )}
              </div>

              <h2 className="py-3 text-2xl font-bold">Course Lessons</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                {course.chapters.map((chapter: any) => {
                  return (
                    <div
                      key={chapter}
                      className=""
                    >
                      <div className="flex text-lg py-4 px-4 outline outline-1 outline-neutral-200/40 font-bold bg-neutral-50 text-neutral-600 items-center">
                        <h3 className="grow">{chapter.name}</h3>
                        <p className="text-sm font-normal text-neutral-400 px-3 py-[2px] outline-1 outline outline-neutral-200 rounded-full ">
                          {chapter.activities.length} Activities
                        </p>
                      </div>
                      <div
                        className="py-3"
                      >{chapter.activities.map((activity: any) => {
                        return (
                          <>
                            <p className="flex text-md">

                            </p>
                            <div className="flex space-x-1 py-2 px-4 items-center">
                              <div className="courseicon items-center flex space-x-2 text-neutral-400">
                                {activity.type === "dynamic" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <Sparkles className="text-gray-400" size={13} />
                                  </div>
                                }
                                {activity.type === "video" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <Video className="text-gray-400" size={13} />
                                  </div>
                                }
                                {activity.type === "documentpdf" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <File className="text-gray-400" size={13} />
                                  </div>
                                }

                              </div>
                              <Link className="flex font-semibold grow pl-2 text-neutral-500" href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`} rel="noopener noreferrer">
                                <p>{activity.name}</p>
                              </Link>
                              <div className="flex ">
                                {activity.type === "dynamic" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`} rel="noopener noreferrer">
                                      <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                        <p>Page</p>
                                        <ArrowRight size={13} /></div>
                                    </Link>
                                  </>
                                }
                                {activity.type === "video" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`} rel="noopener noreferrer">
                                      <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                        <p>Video</p>
                                        <ArrowRight size={13} /></div>
                                    </Link>
                                  </>
                                }
                                {activity.type === "documentpdf" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.id.replace("activity_", "")}`} rel="noopener noreferrer">
                                      <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                        <p>Document</p>
                                        <ArrowRight size={13} /></div>
                                    </Link>
                                  </>
                                }
                              </div>
                            </div>
                          </>
                        );
                      })}</div>
                    </div>
                  );
                })}
              </div>

            </div>
            <div className="course_metadata_right space-y-3 w-64 antialiased flex flex-col ml-10 h-fit p-3 py-5 bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
              { user &&
                <div className="flex mx-auto space-x-3 px-2 py-2 items-center">
                <div className="">
                  <Avvvatars border borderSize={5} borderColor="white" size={50} shadow value={course.course.authors[0]} style='shape' />
                </div>
                <div className="-space-y-2 ">
                  <div className="text-[12px] text-neutral-400 font-semibold">Author</div>
                  <div className="text-xl font-bold text-neutral-800">{user.full_name}</div>
                </div>
              </div>
              }

              {course.trail.status == "ongoing" ? (
                <button className="py-2 px-5 mx-auto rounded-xl text-white font-bold h-12 w-[200px] drop-shadow-md bg-red-600 hover:bg-red-700 hover:cursor-pointer" onClick={quitCourse}>
                  Quit Course
                </button>
              ) : (
                <button className="py-2 px-5 mx-auto rounded-xl text-white font-bold h-12 w-[200px] drop-shadow-md bg-black hover:bg-gray-900 hover:cursor-pointer" onClick={startCourseUI}>Start Course</button>
              )}
            </div>
          </div>
        </GeneralWrapperStyled>
      )}
    </>
  );
};


const StyledBox = (props: any) => (
  <div className="p-3 pl-10 bg-white w-[100%] h-auto ring-1 ring-inset ring-gray-400/10 rounded-lg shadow-sm">
    {props.children}
  </div>

);


export default CourseClient;
