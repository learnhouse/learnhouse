import Link from "next/link";
import React from "react";
import {  Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import styled from "styled-components";

function Lecture(props: any) {

  return (
    <Draggable key={props.lecture.id} draggableId={props.lecture.id} index={props.index}>
      {(provided) => (
        <LectureWrapper key={props.lecture.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <p>{props.lecture.name} </p>
          <Link
            href={`/org/${props.orgslug}/course/${props.courseid}/lecture/${props.lecture.id.replace("lecture_", "")}`}
            
            rel="noopener noreferrer">
            &nbsp; <EyeOpenIcon/>
          </Link>
          <Link
            href={`/org/${props.orgslug}/course/${props.courseid}/lecture/${props.lecture.id.replace("lecture_", "")}/edit`}
            rel="noopener noreferrer">
            &nbsp; <Pencil2Icon/>
          </Link>
        </LectureWrapper>
      )}
    </Draggable>
  );
}

export const LectureWrapper = styled.div`
  padding: 2px;
  padding-left: 17px;
  list-style: none;
  /* padding-left: 2px; */
  background-color: #f4f4f4c5;
  border-radius: 7px;
  margin: 15px;
  display: flex;
  align-items: center;
  &:hover {
    background-color: #8c949c7b;
  }
  
`;
export default Lecture;
