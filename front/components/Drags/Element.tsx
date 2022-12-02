import Link from "next/link";
import React from "react";
import {  Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import styled from "styled-components";

function Element(props: any) {

  return (
    <Draggable key={props.element.id} draggableId={props.element.id} index={props.index}>
      {(provided) => (
        <ElementWrapper key={props.element.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <p>{props.element.name} </p>
          <Link href={`/org/${props.orgslug}/course/${props.courseid}/element/${props.element.id.replace("element_", "")}`}>
            <a  target="_blank" rel="noopener noreferrer">&nbsp; <EyeOpenIcon/></a>
          </Link>
          <Link href={`/org/${props.orgslug}/course/${props.courseid}/element/${props.element.id.replace("element_", "")}/edit`}>
            <a  target="_blank" rel="noopener noreferrer">&nbsp; <Pencil2Icon/></a>
          </Link>
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
