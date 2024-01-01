"use client";
import Link from "next/link";
import { getUriWithOrg } from "@services/config/config";
import Canva from "@components/Objects/Activities/DynamicCanva/DynamicCanva";
import VideoActivity from "@components/Objects/Activities/Video/Video";
import { Check, MoreVertical } from "lucide-react";
import { markActivityAsComplete } from "@services/courses/activity";
import DocumentPdfActivity from "@components/Objects/Activities/DocumentPdf/DocumentPdf";
import ActivityIndicators from "@components/Pages/Courses/ActivityIndicators";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { useRouter } from "next/navigation";
import AuthenticatedClientElement from "@components/Security/AuthenticatedClientElement";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";
import { useOrg } from "@components/Contexts/OrgContext";
import { CourseProvider } from "@components/Contexts/CourseContext";
import AIActivityAsk from "@components/AI/AIActivityAsk";

interface ActivityClientProps {
  activityid: string;
  courseuuid: string;
  orgslug: string;
  activity: any;
  course: any;
}


function ActivityClient(props: ActivityClientProps) {
  const activityid = props.activityid;
  const courseuuid = props.courseuuid;
  const orgslug = props.orgslug;
  const activity = props.activity;
  const course = props.course;
  const org = useOrg() as any;

  function getChapterNameByActivityId(course: any, activity_id: any) {
    for (let i = 0; i < course.chapters.length; i++) {
      let chapter = course.chapters[i];
      for (let j = 0; j < chapter.activities.length; j++) {
        let activity = chapter.activities[j];
        if (activity.id === activity_id) {
          return chapter.name;
        }
      }
    }
    return null; // return null if no matching activity is found
  }



  return (
    <>
      <CourseProvider courseuuid={course?.course_uuid}>
        <GeneralWrapperStyled>
          <div className="space-y-4 pt-4">
            <div className="flex space-x-6">
              <div className="flex">
                <Link href={getUriWithOrg(orgslug, "") + `/course/${courseuuid}`}>
                  <img className="w-[100px] h-[57px] rounded-md drop-shadow-md" src={`${getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)}`} alt="" />
                </Link>
              </div>
              <div className="flex flex-col -space-y-1">
                <p className="font-bold text-gray-700 text-md">Course </p>
                <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase" >{course.name}</h1>
              </div>
            </div>
            <ActivityIndicators course_uuid={courseuuid} current_activity={activityid} orgslug={orgslug} course={course} />

            <div className="flex justify-between items-center">
              <div className="flex flex-col -space-y-1">
                <p className="font-bold text-gray-700 text-md">Chapter : {getChapterNameByActivityId(course, activity.id)}</p>
                <h1 className="font-bold text-gray-950 text-2xl first-letter:uppercase" >{activity.name}</h1>
              </div>
              <div className="flex space-x-1 items-center">
                <AuthenticatedClientElement checkMethod="authentication">
                  <AIActivityAsk activity={activity} />
                  <MoreVertical size={17} className="text-gray-300 " />
                  <MarkStatus activity={activity} activityid={activityid} course={course} orgslug={orgslug} />
                </AuthenticatedClientElement>
              </div>
            </div>

            {activity ? (
              <div className={`p-7 pt-4 drop-shadow-sm rounded-lg ${activity.activity_type == 'TYPE_DYNAMIC' ? 'bg-white' : 'bg-zinc-950'}`}>
                <div>
                  {activity.activity_type == "TYPE_DYNAMIC" && <Canva content={activity.content} activity={activity} />}
                  {/* todo : use apis & streams instead of this */}
                  {activity.activity_type == "TYPE_VIDEO" && <VideoActivity course={course} activity={activity} />}
                  {activity.activity_type == "TYPE_DOCUMENT" && <DocumentPdfActivity course={course} activity={activity} />}
                </div>
              </div>
            ) : (<div></div>)}
            {<div style={{ height: "100px" }}></div>}
          </div>
        </GeneralWrapperStyled>
      </CourseProvider>
    </>
  );
}



export function MarkStatus(props: { activity: any, activityid: string, course: any, orgslug: string }) {
  const router = useRouter();
  console.log(props.course.trail)

  async function markActivityAsCompleteFront() {
    const trail = await markActivityAsComplete(props.orgslug, props.course.course_uuid, 'activity_' + props.activityid);
    router.refresh();
  }

  const isActivityCompleted = () => {
    let run = props.course.trail.runs.find((run: any) => run.course_id == props.course.id);
    if (run) {
      return run.steps.find((step: any) => step.activity_id == props.activity.id);
    }
  }

  console.log('isActivityCompleted', isActivityCompleted());

  return (
    <>{isActivityCompleted() ? (
      <div className="bg-teal-600 rounded-full px-5 drop-shadow-md flex items-center space-x-1  p-2.5  text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out" >
        <i>
          <Check size={17}></Check>
        </i>{" "}
        <i className="not-italic text-xs font-bold">Already completed</i>
      </div>
    ) : (
      <div className="bg-gray-800 rounded-full px-5 drop-shadow-md flex  items-center space-x-1 p-2.5  text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out" onClick={markActivityAsCompleteFront}>
        {" "}
        <i>
          <Check size={17}></Check>
        </i>{" "}
        <i className="not-italic text-xs font-bold">Mark as complete</i>
      </div>
    )}</>
  )
}



export default ActivityClient;
