import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import StarterKit from "@tiptap/starter-kit";
import Text from "@tiptap/extension-text";
import { generateHTML } from "@tiptap/html";
import { useRouter } from "next/router";
import React, { useMemo } from "react";
import Layout from "../../../../../../../components/ui/Layout";
import { getElement } from "../../../../../../../services/courses/elements";

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

  const output = useMemo(() => {
    if (router.isReady) {
      console.log( "el",element.content);
      
      let content = Object.keys(element.content).length > 0 ? element.content : {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "Hello world, this is a example Canva ⚡️"
                    }
                ]
            }
        ]
    }
      console.log("element", content);

      return generateHTML(content, [Document, StarterKit, Paragraph, Text, Bold]);
    }
  }, [element.content]);

  return (
    <Layout>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p>element</p>
          <h1>{element.name} </h1>
          <hr />
          <div dangerouslySetInnerHTML={{ __html: output } as any}></div>
        </div>
      )}
    </Layout>
  );
}

export default ElementPage;
