import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import { Eye, File, MoreVertical, Pencil, Save, Sparkles, Video, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { Draggable } from 'react-beautiful-dnd'
import { mutate } from 'swr'

type ActivitiyElementProps = {
    orgslug: string,
    activity: any,
    activityIndex: any,
    course_uuid: string
}

function ActivityElement(props: ActivitiyElementProps) {
    const router = useRouter();

    async function deleteActivityUI() {
        await deleteActivity(props.activity.id);
        mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`);
        await revalidateTags(['courses'], props.orgslug);
        router.refresh();
    }

    return (
        <Draggable key={props.activity.activity_uuid} draggableId={props.activity.activity_uuid} index={props.activityIndex}>
            {(provided, snapshot) => (
                <div
                    className="flex flex-row py-2 my-2 w-full rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 hover:shadow space-x-1 items-center ring-1 ring-inset ring-gray-400/10 shadow-sm transition-all delay-100 duration-75 ease-linear"
                    key={props.activity.id}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    ref={provided.innerRef}
                >

                    {/*   Activity Type Icon  */}
                    <div className="px-3 text-gray-300 space-x-1 w-28" >
                        {props.activity.activity_type === "video" &&
                            <>
                                <div className="flex space-x-2 items-center">
                                    <Video size={16} />
                                    <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full mx-auto justify-center align-middle">Video</div>
                                </div>
                            </>}
                    </div>


                    {/*   Centered Activity Name  */}
                    <div className="grow items-center space-x-2 flex mx-auto justify-center">
                        {(<p className="first-letter:uppercase"> {props.activity.name} </p>)}
                        <Pencil size={12} className="text-neutral-400 hover:cursor-pointer" />
                    </div>
                    {/*   Edit and View Button  */}
                    <div className="flex flex-row space-x-2">
                        {props.activity.activity_type === "TYPE_DYNAMIC" && <>
                            <Link
                                href={''}
                                className=" hover:cursor-pointer p-1 px-3 bg-sky-700 rounded-md items-center"
                                rel="noopener noreferrer">
                                <div className="text-sky-100 font-bold text-xs" >Edit  </div>
                            </Link>
                        </>}
                        <Link
                            href={''}
                            className=" hover:cursor-pointer p-1 px-3 bg-gray-200 rounded-md"
                            rel="noopener noreferrer">
                            <Eye strokeWidth={2} size={15} className="text-gray-600" />
                        </Link>
                    </div>
                    {/*   Delete Button  */}
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
                            functionToExecute={() => deleteActivityUI()}
                            status='warning'
                        ></ConfirmationModal></div>
                </div>
            )}
        </Draggable>
    )
}

export default ActivityElement