import React from "react";
import {  Draggable } from "react-beautiful-dnd";
import styled from "styled-components";

function Element(props: any) {
  return (
    <Draggable draggableId={props.element.id} index={props.index}>
      {(provided) => (
        <ElementWrapper {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          {props.element.content}
        </ElementWrapper>
      )}
    </Draggable>
  );
}

export const ElementWrapper = styled.div`
  padding: 10px;
  padding-left: 17px;
  list-style: none;
  /* padding-left: 2px; */
  background-color: #8c949c33;
  border-radius: 28px;
  margin: 15px;

  &:hover {
    background-color: #8c949c7b;
  }
  
`;
export default Element;
