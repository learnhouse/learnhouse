
"use client";
import { default as React, useEffect, useRef } from "react";


import { useRouter } from "next/navigation";
import { getActivity } from "@services/courses/activities";
import AuthProvider from "@components/Security/AuthProvider";
import EditorWrapper from "@components/Editor/EditorWrapper";
import useSWR, { mutate } from "swr";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/requests";


function EditActivity(params: any) {
  const router = useRouter();
  const activityid = params.params.activityid;
  const courseid = params.params.courseid;
  const { data: courseInfo, error: error_course } = useSWR(`${getAPIUrl()}courses/meta/course_${courseid}`, swrFetcher);
  const { data: activity, error: error_activity } = useSWR(`${getAPIUrl()}activities/activity_${activityid}`, swrFetcher);


  

  return (
    <AuthProvider>
      {!courseInfo || !activity  ? <div>Loading...</div> : <EditorWrapper course={courseInfo} activity={activity} content={activity.content}></EditorWrapper>}
    </AuthProvider>
  );
}

export default EditActivity;
