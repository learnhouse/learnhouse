"use client";
import Link from "next/link";
import { getUriWithOrg } from "@services/config/config";
import Canva from "@components/Objects/Activities/DynamicCanva/DynamicCanva";
import VideoActivity from "@components/Objects/Activities/Video/Video";
import { Check } from "lucide-react";
import { markActivityAsComplete } from "@services/courses/activity";
import DocumentPdfActivity from "@components/Objects/Activities/DocumentPdf/DocumentPdf";
import ActivityIndicators from "@components/Pages/Courses/ActivityIndicators";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { useRouter } from "next/navigation";
import AuthenticatedClientElement from "@components/Security/AuthenticatedClientElement";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";
import { useOrg } from "@components/Contexts/OrgContext";

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
  const org = useOrg() as any;

  function getChapterName(chapterId: string) {
    let chapterName = "";
    course.chapters.forEach((chapter: any) => {
      if (chapter.id === chapterId) {
        chapterName = chapter.name;
      } 
    });
    return chapterName;
  }



  return (
    <>
      <GeneralWrapperStyled>
        <div className="space-y-4 pt-4">
          <div className="flex space-x-6">
            <div className="flex">
              <Link href={getUriWithOrg(orgslug, "") + `/course/${courseid}`}>
                <img className="w-[100px] h-[57px] rounded-md drop-shadow-md" src={`${getCourseThumbnailMediaDirectory(org?.org_uuid, course.course.course_uuid, course.course.thumbnail_image)}`} alt="" />
              </Link>
            </div>
            <div className="flex flex-col -space-y-1">
              <p className="font-bold text-gray-700 text-md">Course </p>
              <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase" >{course.course.name}</h1>
            </div>
          </div>
          <ActivityIndicators course_uuid={courseid} current_activity={activityid} orgslug={orgslug} course={course} />

          <div className="flex justify-between items-center">
            <div className="flex flex-col -space-y-1">
              <p className="font-bold text-gray-700 text-md">Chapter : {getChapterName(activity.coursechapter_id)}</p>
              <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase" >{activity.name}</h1>
            </div>
            <div className="flex space-x-2">
              <AuthenticatedClientElement checkMethod="authentication">
                <MarkStatus activityid={activityid} course={course} orgslug={orgslug} courseid={courseid} />

              </AuthenticatedClientElement>
            </div>
          </div>

          {activity ? (
            <div className={`p-7 pt-4 drop-shadow-sm rounded-lg ${activity.type == 'dynamic' ? 'bg-white' : 'bg-zinc-950'}`}>
              <div>
                {activity.type == "dynamic" && <Canva content={activity.content} activity={activity} />}
                {/* todo : use apis & streams instead of this */}
                {activity.type == "video" && <VideoActivity course={course} activity={activity} />}
                {activity.type == "documentpdf" && <DocumentPdfActivity course={course} activity={activity} />}
              </div>
            </div>
          ) : (<div></div>)}
          {<div style={{ height: "100px" }}></div>}
        </div>
      </GeneralWrapperStyled>
    </>
  );
}



export function MarkStatus(props: { activityid: string, course: any, orgslug: string, courseid: string }) {
  const router = useRouter();


  async function markActivityAsCompleteFront() {
    const trail = await markActivityAsComplete(props.orgslug, props.courseid, props.activityid);
    router.refresh();

    // refresh page (FIX for Next.js BUG)
    //window.location.reload();

  }

  return (
    <>{props.course.trail.activities_marked_complete &&
      props.course.trail.activities_marked_complete.includes("activity_" + props.activityid) &&
      props.course.trail.status == "ongoing" ? (
      <div className="bg-teal-600 rounded-md drop-shadow-md flex flex-col p-3 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out" >
        <i>
          <Check size={15}></Check>
        </i>{" "}
        Already completed
      </div>
    ) : (
      <div className="bg-zinc-600 rounded-md drop-shadow-md flex flex-col p-3 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out" onClick={markActivityAsCompleteFront}>
        {" "}
        <i>
          <Check size={15}></Check>
        </i>{" "}
        Mark as complete
      </div>
    )}</>
  )
}



export default ActivityClient;
