import { useEditorProvider } from "@components/Contexts/Editor/EditorContext";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle } from "lucide-react";
import React from "react";
import styled from "styled-components";

function WarningCalloutComponent(props: any) {
  const editorState = useEditorProvider() as any;
  const isEditable = editorState.isEditable;
  
  return (
    <NodeViewWrapper>
      <CalloutWrapper className="flex space-x-2 items-center bg-yellow-200 rounded-lg text-yellow-900 px-3 shadow-inner" contentEditable={isEditable}>
        <AlertTriangle /> <NodeViewContent contentEditable={isEditable} className="content" />
      </CalloutWrapper>
    </NodeViewWrapper>
  );
}

const CalloutWrapper = styled.div`
  

  svg {
    padding: 3px;
  }

  .content {
    margin: 5px;
    padding: 0.5rem;
    border: ${(props) => (props.contentEditable ? "2px dashed #713f1117" : "none")};
    border-radius: 0.5rem;
  }
`;

const DragHandle = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 1rem;
  height: 100%;
  cursor: move;
  z-index: 1;
`;

export default WarningCalloutComponent;
