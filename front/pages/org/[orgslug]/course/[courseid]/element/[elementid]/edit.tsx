import { default as React, useEffect, useRef } from "react";

import Layout from "../../../../../../../components/rename/UI/Layout";
import { Title } from "../../../../../../../components/rename/UI/Elements/Styles/Title";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { getElement } from "../../../../../../../services/courses/elements";
import AuthProvider from "../../../../../../../components/security/AuthProvider";
import EditorWrapper from "../../../../../../../components/Editor/EditorWrapper";

// Workaround (Next.js SSR doesn't support tip tap editor)
const Editor: any = dynamic(() => import("../../../../../../../components/Editor/EditorWrapper") as any, {
  ssr: false,
});

function EditElement() {
  const router = useRouter();
  const { elementid } = router.query;
  const [element, setElement] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchElementData() {
    const element = await getElement("element_" + elementid);
    setElement(element);
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (router.isReady) {
      fetchElementData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return <AuthProvider>{isLoading ? <div>Loading...</div> : <EditorWrapper element={element} content={element.content}></EditorWrapper>}</AuthProvider>;
}

export default EditElement;
