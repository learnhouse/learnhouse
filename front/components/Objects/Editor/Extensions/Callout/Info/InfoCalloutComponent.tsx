import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { AlertCircle } from "lucide-react";
import React from "react";
import styled from "styled-components";

function InfoCalloutComponent(props: any) {
  return (
    <NodeViewWrapper>
      <InfoCalloutWrapper contentEditable={props.extension.options.editable}>
        <AlertCircle /> <NodeViewContent contentEditable={props.extension.options.editable} className="content" />
      </InfoCalloutWrapper>
    </NodeViewWrapper>
  );
}

const InfoCalloutWrapper = styled.div`
  display: flex;
  flex-direction: row;
  color: #1f3a8a;
  background-color: #dbe9fe;
  border: 1px solid #c1d9fb;
  border-radius: 16px;
  margin: 1rem 0;
  align-items: center;
  padding-left: 15px;
  
  svg{
    padding: 3px;
  }

  .content {
    margin: 5px;
    padding: 0.5rem;
    border: ${(props) => (props.contentEditable ? "2px dashed #1f3a8a12" : "none")};
    border-radius: 0.5rem;
  }
`;



export default InfoCalloutComponent;
