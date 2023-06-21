import Link from "next/link";
import React from "react";
import { Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import styled from "styled-components";
import { getUriWithOrg } from "@services/config/config";

function Activity(props: any) {

  return (
    <Draggable key={props.activity.id} draggableId={props.activity.id} index={props.index}>
      {(provided) => (
        <div
          className="flex flex-row items-center py-2 my-3 rounded-md justify-center bg-gray-50 hover:bg-gray-100 space-x-2 w-auto" key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <p>{props.activity.name} </p>
          <Link
            href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}`}

            rel="noopener noreferrer"> <EyeOpenIcon />
          </Link>
          <Link
            href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}/edit`}
            rel="noopener noreferrer">
            <Pencil2Icon />
          </Link>
        </div>
      )}
    </Draggable>
  );
}


export default Activity;
