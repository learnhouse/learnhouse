import { default as React, } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import Editor from "./Editor";
import { updateElement } from "../../services/courses/elements";

interface EditorWrapperProps {
  content: string;
  element: any;
  course:any
}

function EditorWrapper(props: EditorWrapperProps) {
  // A new Y document
  const ydoc = new Y.Doc();
  const [providerState, setProviderState] = React.useState<any>({});
  const [ydocState, setYdocState] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  function createRTCProvider() {
    const provider = new WebrtcProvider(props.element.element_id, ydoc);
    setYdocState(ydoc);
    setProviderState(provider);
    setIsLoading(false);
  }

  async function setContent(content: any) {
    let element = props.element;
    element.content = content;
    const res = await updateElement(element, element.element_id);
    alert(JSON.stringify(res));
  }

  if (isLoading) {
    createRTCProvider();
  } else {
    return <Editor course={props.course} element={props.element} content={props.content} setContent={setContent} provider={providerState} ydoc={ydocState}></Editor>;
  }
}

export default EditorWrapper;
