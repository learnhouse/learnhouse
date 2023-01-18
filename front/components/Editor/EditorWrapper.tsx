import { default as React, } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import Editor from "./Editor";
import { updateLecture } from "../../services/courses/lectures";

interface EditorWrapperProps {
  content: string;
  lecture: any;
  course:any
}

function EditorWrapper(props: EditorWrapperProps) : JSX.Element {
  // A new Y document
  const ydoc = new Y.Doc();
  const [providerState, setProviderState] = React.useState<any>({});
  const [ydocState, setYdocState] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  function createRTCProvider() {
   // const provider = new WebrtcProvider(props.lecture.lecture_id, ydoc);
   // setYdocState(ydoc);
   // setProviderState(provider);
    setIsLoading(false);
  }

  async function setContent(content: any) {
    let lecture = props.lecture;
    lecture.content = content;
    const res = await updateLecture(lecture, lecture.lecture_id);
    alert(JSON.stringify(res));
  }

  if (isLoading) {
    createRTCProvider();
    return <div>Loading...</div>;
  } else {
    return <Editor course={props.course} lecture={props.lecture} content={props.content} setContent={setContent} provider={providerState} ydoc={ydocState}></Editor>;
  }
}

export default EditorWrapper;
