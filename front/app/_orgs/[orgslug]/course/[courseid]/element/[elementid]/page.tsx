"use client";
import { useRouter } from "next/navigation";
import React, { useMemo } from "react";
import Layout from "../../../../../../../components/UI/Layout";
import { getElement } from "../../../../../../../services/courses/elements";
import { getBackendUrl } from "../../../../../../../services/config";
import Canva from "../../../../../../../components/Canva/Canva";

function ElementPage(params: any) {
  const router = useRouter();
  const elementid = params.params.elementid;
  const [element, setElement] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  async function fetchElementData() {
    const element = await getElement("element_" + elementid);
    setElement(element);
    setIsLoading(false);
  }

  React.useEffect(() => {
    if (elementid) {
      fetchElementData();
    }
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementid]);

  return (
    <Layout>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p>element</p>
          <h1>{element.name} </h1>
          <hr />

          {element.type == "dynamic" && <Canva content= {element.content} element={element}/>}
          {/* todo : use apis & streams instead of this */}
          {element.type == "video" && (
            <video controls src={`${getBackendUrl()}content/uploads/video/${element.content.video.element_id}/${element.content.video.filename}`}></video>
          )}
        </div>
      )}
    </Layout>
  );
}

export default ElementPage;
