import { default as React, useEffect, useRef } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import EditorWithOptions from "./EditorWithOptions";

// tools

function Editor() {
  // A new Y document
  const ydoc = new Y.Doc();
  const [providerState, setProviderState] = React.useState<any>({});
  const [ydocState, setYdocState] = React.useState<any>({});
  const [isLoading, setIsLoading] = React.useState(true);

  function createRTCProvider() {
    const provider = new WebrtcProvider("learnhouse-1", ydoc);
    setYdocState(ydoc);
    setProviderState(provider);
    setIsLoading(false);
  }

  if (isLoading) {
    createRTCProvider();
  } else {
    return (
      <div>
        <EditorWithOptions provider={providerState} ydoc={ydocState}></EditorWithOptions>
      </div>
    );
  }
}

export default Editor;
