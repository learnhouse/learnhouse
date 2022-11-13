import { default as React, useEffect, useRef } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import EditorWithOptions from "./EditorWithOptions";
import { IndexeddbPersistence } from "y-indexeddb";
import { updateElement } from "../../services/courses/elements";

interface EditorProps {
  content: string;
  element: any;
}

function Editor(props: EditorProps) {
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
    element.content = content.content;
    const res = await updateElement(element, element.element_id);
    
  }

  if (isLoading) {
    createRTCProvider();
  } else {
    return (
      <div>
        <EditorWithOptions content={props.content} setContent={setContent} provider={providerState} ydoc={ydocState}></EditorWithOptions>
      </div>
    );
  }
}

export default Editor;
