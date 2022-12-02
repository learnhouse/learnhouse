import { default as React, useEffect, useRef } from "react";

import Layout from "../../../../../../../components//UI/Layout";
import { Title } from "../../../../../../../components//UI/Elements/Styles/Title";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { getElement } from "../../../../../../../services/courses/elements";
import AuthProvider from "../../../../../../../components/Security/AuthProvider";
import EditorWrapper from "../../../../../../../components/Editor/EditorWrapper";
import { getCourseMetadata } from "../../../../../../../services/courses/courses";

// Workaround (Next.js SSR doesn't support tip tap editor)
const Editor: any = dynamic(() => import("../../../../../../../components/Editor/EditorWrapper") as any, {
  ssr: false,
});

function EditElement() {
  const router = useRouter();
  const { elementid, courseid } = router.query;
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
    if (router.isReady) {
      fetchAllData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return (
    <AuthProvider>
      {isLoading ? <div>Loading...</div> : <EditorWrapper course={courseInfo} element={element} content={element.content}></EditorWrapper>}
    </AuthProvider>
  );
}

export default EditElement;
