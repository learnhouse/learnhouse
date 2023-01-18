
"use client";
import { default as React, useEffect, useRef } from "react";


import { useRouter } from "next/navigation";
import { getLecture } from "../../../../../../../../services/courses/lectures";
import AuthProvider from "../../../../../../../../components/Security/AuthProvider";
import EditorWrapper from "../../../../../../../../components/Editor/EditorWrapper";
import { getCourseMetadata } from "../../../../../../../../services/courses/courses";


function EditLecture(params: any) {
  const router = useRouter();
  const lectureid = params.params.lectureid;
  const courseid = params.params.courseid;
  const [lecture, setLecture] = React.useState<any>({});
  const [courseInfo, setCourseInfo] = React.useState({}) as any;
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchLectureData() {
    const lecture = await getLecture("lecture_" + lectureid);
    setLecture(lecture);
  }

  async function fetchCourseInfo() {
    const course = await getCourseMetadata("course_" + courseid);
    setCourseInfo(course);
  }

  async function fetchAllData() {
    await fetchLectureData();
    await fetchCourseInfo();
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (lectureid && courseid) {
      fetchAllData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureid, courseid ]);

  return (
    <AuthProvider>
      {isLoading ? <div>Loading...</div> : <EditorWrapper course={courseInfo} lecture={lecture} content={lecture.content}></EditorWrapper>}
    </AuthProvider>
  );
}

export default EditLecture;
