import Link from "next/link";
import React from "react";
import { Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import styled from "styled-components";
import { getUriWithOrg } from "@services/config/config";
import { FileText, Video, Sparkles } from "lucide-react";

function Activity(props: any) {

  return (
    <Draggable key={props.activity.id} draggableId={props.activity.id} index={props.index}>
      {(provided) => (
        <div
          className="flex flex-row items-center py-2 my-3 rounded-md justify-center bg-gray-50 hover:bg-gray-100 space-x-2 w-auto" key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <div >
            {props.activity.type === "video" && <Video size={16} />}
            {props.activity.type === "documentpdf" && <FileText size={16} />}
            {props.activity.type === "dynamic" && <Sparkles size={16} />}

          </div>
          <p className="first-letter:uppercase">{props.activity.name} </p>
          <Link
            href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}`}
            className=" hover:cursor-pointer p-1 rounded-md bg-slate-200"
            rel="noopener noreferrer"> 
            <EyeOpenIcon className="text-slate-700"/>
          </Link>
          <Link
            href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}/edit`}
            className=" hover:cursor-pointer p-1 rounded-md bg-slate-200"
            rel="noopener noreferrer">
            <Pencil2Icon className="text-slate-700" />
          </Link>
        </div>
      )}
    </Draggable>
  );
}


export default Activity;
