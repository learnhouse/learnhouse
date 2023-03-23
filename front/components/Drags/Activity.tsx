import Link from "next/link";
import React from "react";
import {  Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import styled from "styled-components";
import { getUriWithOrg } from "@services/config/config";

function Activity(props: any) {

  return (
    <Draggable key={props.activity.id} draggableId={props.activity.id} index={props.index}>
      {(provided) => (
        <ActivityWrapper key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <p>{props.activity.name} </p>
          <Link
            href={getUriWithOrg(props.orgslug,"")+`/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}`}
            
            rel="noopener noreferrer">
            &nbsp; <EyeOpenIcon/>
          </Link>
          <Link
            href={getUriWithOrg(props.orgslug,"") +`/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}/edit`}
            rel="noopener noreferrer">
            &nbsp; <Pencil2Icon/>
          </Link>
        </ActivityWrapper>
      )}
    </Draggable>
  );
}

export const ActivityWrapper = styled.div`
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
export default Activity;
