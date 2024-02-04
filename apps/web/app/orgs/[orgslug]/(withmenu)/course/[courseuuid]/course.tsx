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
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from "@services/media/media";
import { ArrowRight, Check, File, Sparkles, Star, Video } from "lucide-react";
import Avvvatars from "avvvatars-react";
import { getUser } from "@services/users/users";
import { useOrg } from "@components/Contexts/OrgContext";
import UserAvatar from "@components/Objects/UserAvatar";

const CourseClient = (props: any) => {
  const [user, setUser] = useState<any>({});
  const [learnings, setLearnings] = useState<any>([]);
  const courseuuid = props.courseuuid;
  const orgslug = props.orgslug;
  const course = props.course;
  const org = useOrg() as any;
  const router = useRouter();

  function getLearningTags() {
    // create array of learnings from a string object (comma separated)
    let learnings = course.learnings.split(",");
    setLearnings(learnings);

  }


  async function startCourseUI() {
    // Create activity
    await startCourse("course_" + courseuuid, orgslug);
    await revalidateTags(['courses'], orgslug);
    router.refresh();

    // refresh page (FIX for Next.js BUG)
    // window.location.reload();
  }

  function isCourseStarted() {
    const runs = course.trail?.runs;
    if (!runs) return false;
    return runs.some((run: any) => run.status === "STATUS_IN_PROGRESS" && run.course_id === course.id);
  }

  async function quitCourse() {
    // Close activity
    let activity = await removeCourse("course_" + courseuuid, orgslug);
    // Mutate course
    await revalidateTags(['courses'], orgslug);
    router.refresh();
  }

  useEffect(() => {
    getLearningTags();
  }
    , [org]);

  return (
    <>
      {!course ? (
        <PageLoading></PageLoading>
      ) : (
        <GeneralWrapperStyled>
          <div className="pb-3">
            <p className="text-md font-bold text-gray-400 pb-2">Course</p>
            <h1 className="text-3xl -mt-3 font-bold">
              {course.name}
            </h1>
          </div>

          {props.course.thumbnail_image ?
            <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-auto h-[400px] bg-cover bg-center mb-4" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)})` }}>
            </div>
            :
            <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-auto h-[400px] bg-cover bg-center mb-4" style={{ backgroundImage: `url('../empty_thumbnail.png')`, backgroundSize: 'auto' }}>
            </div>
          }

          <ActivityIndicators course_uuid={props.course.course_uuid} orgslug={orgslug} course={course} />

          <div className="flex flex-row pt-10">
            <div className="course_metadata_left grow space-y-2">
              <h2 className="py-3 text-2xl font-bold">Description</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
                <p className="py-5 px-5">{course.description}</p>
              </div>

              <h2 className="py-3 text-2xl font-bold">What you will learn</h2>
              <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden px-5 py-5 space-y-2">
                {learnings.map((learning: any) => {
                  return (
                    <div key={learning}
                      className="flex space-x-2 items-center font-semibold text-gray-500">
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
                                {activity.activity_type === "TYPE_DYNAMIC" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <Sparkles className="text-gray-400" size={13} />
                                  </div>
                                }
                                {activity.activity_type === "TYPE_VIDEO" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <Video className="text-gray-400" size={13} />
                                  </div>
                                }
                                {activity.activity_type === "TYPE_DOCUMENT" &&
                                  <div className="bg-gray-100 px-2 py-2 rounded-full">
                                    <File className="text-gray-400" size={13} />
                                  </div>
                                }

                              </div>
                              <Link className="flex font-semibold grow pl-2 text-neutral-500" href={getUriWithOrg(orgslug, "") + `/course/${courseuuid}/activity/${activity.activity_uuid.replace("activity_", "")}`} rel="noopener noreferrer">
                                <p>{activity.name}</p>
                              </Link>
                              <div className="flex ">
                                {activity.activity_type === "TYPE_DYNAMIC" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseuuid}/activity/${activity.activity_uuid.replace("activity_", "")}`} rel="noopener noreferrer">
                                      <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                        <p>Page</p>
                                        <ArrowRight size={13} /></div>
                                    </Link>
                                  </>
                                }
                                {activity.activity_type === "TYPE_VIDEO" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseuuid}/activity/${activity.activity_uuid.replace("activity_", "")}`} rel="noopener noreferrer">
                                      <div className="text-xs bg-gray-100 text-gray-400 font-bold px-2 py-1 rounded-full flex space-x-1 items-center">
                                        <p>Video</p>
                                        <ArrowRight size={13} /></div>
                                    </Link>
                                  </>
                                }
                                {activity.activity_type === "TYPE_DOCUMENT" &&
                                  <>
                                    <Link className="flex grow pl-2 text-gray-500" href={getUriWithOrg(orgslug, "") + `/course/${courseuuid}/activity/${activity.activity_uuid.replace("activity_", "")}`} rel="noopener noreferrer">
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
            <div className="course_metadata_right space-y-3 w-72 antialiased flex flex-col ml-10 h-fit p-3 py-5 bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
              {user &&
                <div className="flex flex-col mx-auto space-y-3 px-2 py-2 items-center">
                  <UserAvatar border="border-8" avatar_url={getUserAvatarMediaDirectory(course.authors[0].user_uuid,course.authors[0].avatar_image)} width={100} />
                  <div className="-space-y-2 ">
                    <div className="text-[12px] text-neutral-400 font-semibold">Author</div>
                    <div className="text-xl font-bold text-neutral-800">
                      {course.authors[0].first_name && course.authors[0].last_name && (
                      <div className="flex space-x-2 items-center">
                        <p>{course.authors[0].first_name + ' ' + course.authors[0].last_name}</p><span className="text-xs bg-neutral-100 p-1 px-3 rounded-full text-neutral-400 font-semibold"> @{course.authors[0].username }</span>
                      </div>)}
                      {!course.authors[0].first_name && !course.authors[0].last_name && (
                      <div className="flex space-x-2 items-center">
                        <p>@{course.authors[0].username}</p>
                      </div>)}
                      </div>
                  </div>
                </div>
              }

              {isCourseStarted() ? (
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
