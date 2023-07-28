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
          className="flex flex-row py-2 my-2 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-105 hover:shadow space-x-2 w-auto items-center ring-1 ring-inset ring-gray-400/10 shadow-sm transition-all delay-100 duration-75 ease-linear" key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <div className="px-3 text-gray-300 space-x-1" >
            {props.activity.type === "video" && <Video size={16} />}
            {props.activity.type === "documentpdf" && <FileText size={16} />}
            {props.activity.type === "dynamic" && <Sparkles size={16} />}
          </div>
          <div className="grow justify-end text-center items-center">
            <p className="first-letter:uppercase">{props.activity.name} </p>
          </div>
          <div className="flex flex-row space-x-1 px-3"><Link
            href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}`}
            className=" hover:cursor-pointer p-1 rounded-md "
            rel="noopener noreferrer">
            <EyeOpenIcon className="text-gray-500" />
          </Link>
            <Link
              href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}/edit`}
              className=" hover:cursor-pointer p-1 rounded-md "
              rel="noopener noreferrer">
              <Pencil2Icon className="text-gray-500" />
            </Link></div>
        </div>
      )}
    </Draggable>
  );
}


export default Activity;
