import Link from "next/link";
import { Draggable } from "react-beautiful-dnd";
import { EyeOpenIcon, Pencil2Icon, TrashIcon } from '@radix-ui/react-icons'
import { getAPIUrl, getUriWithOrg } from "@services/config/config";
import { FileText, Video, Sparkles, XSquare, X, Pencil, MoreVertical, Eye } from "lucide-react";
import { mutate } from "swr";
import { revalidateTags } from "@services/utils/ts/requests";
import { useRouter } from "next/navigation";
import ConfirmationModal from "@components/StyledElements/ConfirmationModal/ConfirmationModal";
import { deleteActivity } from "@services/courses/activities";

function Activity(props: any) {
  const router = useRouter();

  async function removeActivity() {
    await deleteActivity(props.activity.id);
    mutate(`${getAPIUrl()}chapters/meta/course_${props.courseid}`);
    await revalidateTags(['courses'], props.orgslug);
    router.refresh();
  }


  return (
    <Draggable key={props.activity.id} draggableId={props.activity.id} index={props.index}>
      {(provided) => (
        <div
          className="flex flex-row py-2 my-2 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 hover:shadow space-x-1 w-auto items-center ring-1 ring-inset ring-gray-400/10 shadow-sm transition-all delay-100 duration-75 ease-linear" key={props.activity.id} {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
          <div className="px-3 text-gray-300 space-x-1 w-28" >
            {props.activity.type === "video" && <><div className="flex space-x-2 items-center"><Video size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Video</div> </div></>}
            {props.activity.type === "documentpdf" && <><div className="flex space-x-2 items-center"><FileText size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Document</div> </div></>}
            {props.activity.type === "dynamic" && <><div className="flex space-x-2 items-center"><Sparkles size={16} /> <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">Dynamic</div> </div></>}
          </div>

          <div className="grow items-center space-x-1 flex">
            <p className="first-letter:uppercase"> {props.activity.name} </p>
          </div>

          <div className="flex flex-row space-x-2">
          {props.activity.type === "dynamic" && <>
              <Link
                href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}/edit`}
                className=" hover:cursor-pointer p-1 px-3 bg-sky-700 rounded-md items-center"
                rel="noopener noreferrer">
                <div className="text-sky-100 font-bold text-xs" >Edit </div>
              </Link>
            </>}
            <Link
              href={getUriWithOrg(props.orgslug, "") + `/course/${props.courseid}/activity/${props.activity.id.replace("activity_", "")}`}
              className=" hover:cursor-pointer p-1 px-3 bg-gray-200 rounded-md"
              rel="noopener noreferrer">
              <Eye strokeWidth={2} size={15} className="text-gray-600" />
            </Link>

            

          </div>
          <div className="flex flex-row pr-3 space-x-1 items-center">
            <MoreVertical size={15} className="text-gray-300" />
            <ConfirmationModal
              confirmationMessage="Are you sure you want to delete this activity ?"
              confirmationButtonText="Delete Activity"
              dialogTitle={"Delete " + props.activity.name + " ?"}
              dialogTrigger={
                <div
                  className=" hover:cursor-pointer p-1 px-5 bg-red-600 rounded-md"
                  rel="noopener noreferrer">
                  <X size={15} className="text-rose-200 font-bold" />
                </div>}
              functionToExecute={() => removeActivity()}
              status='warning'
            ></ConfirmationModal></div>
        </div>
      )}
    </Draggable>
  );
}


export default Activity;
