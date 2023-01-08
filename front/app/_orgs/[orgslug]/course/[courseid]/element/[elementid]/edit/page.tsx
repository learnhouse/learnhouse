"use client";
import { default as React, useEffect, useRef } from "react";

import Layout from "../../../../../../../../components/UI/Layout";
import { Title } from "../../../../../../../../components/UI/Elements/Styles/Title";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { getElement } from "../../../../../../../../services/courses/elements";
import AuthProvider from "../../../../../../../../components/Security/AuthProvider";
import EditorWrapper from "../../../../../../../../components/Editor/EditorWrapper";
import { getCourseMetadata } from "../../../../../../../../services/courses/courses";

// Workaround (Next.js SSR doesn't support tip tap editor)
const Editor: any = dynamic(() => import("../../../../../../../../components/Editor/EditorWrapper") as any, {
  ssr: false,
});

function EditElement(params: any) {
  const router = useRouter();
  const elementid = params.params.elementid;
  const courseid = params.params.courseid;
  const [element, setElement] = React.useState<any>({});
  const [courseInfo, setCourseInfo] = React.useState({}) as any;
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchElementData() {
    const element = await getElement("element_" + elementid);
    setElement(element);
  }

  async function fetchCourseInfo() {
    const course = await getCourseMetadata("course_" + courseid);
    setCourseInfo(course);
  }

  async function fetchAllData() {
    await fetchElementData();
    await fetchCourseInfo();
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (elementid && courseid) {
      fetchAllData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementid, courseid ]);

  return (
    <AuthProvider>
      {isLoading ? <div>Loading...</div> : <EditorWrapper course={courseInfo} element={element} content={element.content}></EditorWrapper>}
    </AuthProvider>
  );
}

export default EditElement;
