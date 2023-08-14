import Link from "next/link";
import { Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon } from '@radix-ui/react-icons'
import { getUriWithOrg } from "@services/config/config";
import { FileText, Video, Sparkles, File } from "lucide-react";

function Activity(props: any) {

  return (
    <Draggable key={props.activity.id} draggableId={props.activity.id} index={props.index}>
      {(provided) => (
        <div
          className="flex flex-row py-2 my-2 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 hover:shadow space-x-2 w-auto items-center ring-1 ring-inset ring-gray-400/10 shadow-sm transition-all delay-100 duration-75 ease-linear" key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <div className="px-3 text-gray-300 space-x-1 w-28" >
            {props.activity.type === "video" && <><div className="flex space-x-2 items-center"><Video size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Video</div> </div></>}
            {props.activity.type === "documentpdf" && <><div className="flex space-x-2 items-center"><FileText size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Document</div> </div></>}
            {props.activity.type === "dynamic" && <><div className="flex space-x-2 items-center"><Sparkles size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Dynamic</div> </div></>}
          </div>
          <div className="grow items-center space-x-1 flex">
            <p className="first-letter:uppercase"> {props.activity.name} </p>
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
