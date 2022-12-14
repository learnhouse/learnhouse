import { useRouter } from "next/router";
import React, { useMemo } from "react";
import Layout from "../../../../../../../components//UI/Layout";
import { getElement } from "../../../../../../../services/courses/elements";
import { getBackendUrl } from "../../../../../../../services/config";
import Canva from "../../../../../../../components/Canva/Canva";

function ElementPage() {
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
