
"use client";
import { default as React, useEffect, useRef } from "react";


import { useRouter } from "next/navigation";
import { getLecture } from "@services/courses/lectures";
import AuthProvider from "@components/Security/AuthProvider";
import EditorWrapper from "@components/Editor/EditorWrapper";
import useSWR, { mutate } from "swr";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/requests";


function EditLecture(params: any) {
  const router = useRouter();
  const lectureid = params.params.lectureid;
  const courseid = params.params.courseid;
  const { data: courseInfo, error: error_course } = useSWR(`${getAPIUrl()}courses/meta/course_${courseid}`, swrFetcher);
  const { data: lecture, error: error_lecture } = useSWR(`${getAPIUrl()}lectures/lecture_${lectureid}`, swrFetcher);


  

  return (
    <AuthProvider>
      {!courseInfo || !lecture  ? <div>Loading...</div> : <EditorWrapper course={courseInfo} lecture={lecture} content={lecture.content}></EditorWrapper>}
    </AuthProvider>
  );
}

export default EditLecture;
