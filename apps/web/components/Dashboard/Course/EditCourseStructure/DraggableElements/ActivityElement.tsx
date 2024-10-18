import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Backpack,
  Eye,
  File,
  FilePenLine,
  Globe,
  Lock,
  MoreVertical,
  Pencil,
  Save,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { Draggable } from 'react-beautiful-dnd'
import { mutate } from 'swr'
import { deleteAssignmentUsingActivityUUID, getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import toast from 'react-hot-toast'

type ActivitiyElementProps = {
  orgslug: string
  activity: any
  activityIndex: any
  course_uuid: string
}

interface ModifiedActivityInterface {
  activityId: string
  activityName: string
}

function ActivityElement(props: ActivitiyElementProps) {
  const router = useRouter()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [modifiedActivity, setModifiedActivity] = React.useState<
    ModifiedActivityInterface | undefined
  >(undefined)
  const [selectedActivity, setSelectedActivity] = React.useState<
    string | undefined
  >(undefined)
  const activityUUID = props.activity.activity_uuid

  async function deleteActivityUI() {
    const toast_loading = toast.loading('Deleting activity...')
    // Assignments 
    if (props.activity.activity_type === 'TYPE_ASSIGNMENT') {
      await deleteAssignmentUsingActivityUUID(props.activity.activity_uuid, access_token)
    }

    await deleteActivity(props.activity.activity_uuid, access_token)
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
    await revalidateTags(['courses'], props.orgslug)
    toast.dismiss(toast_loading)
    toast.success('Activity deleted successfully')
    router.refresh()
  }

  async function changePublicStatus() {
    const toast_loading = toast.loading('Updating assignment...')
    await updateActivity(
      {
        ...props.activity,
        published: !props.activity.published,
      },
      props.activity.activity_uuid,
      access_token
    )
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
    toast.dismiss(toast_loading)
    toast.success('The activity has been updated successfully')
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateActivityName(activityId: string) {
    if (
      modifiedActivity?.activityId === activityId &&
      selectedActivity !== undefined
    ) {
      
      let modifiedActivityCopy = {
        ...props.activity,
        name: modifiedActivity.activityName,
      }

      await updateActivity(modifiedActivityCopy, activityUUID, access_token)
      mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
    setSelectedActivity(undefined)
  }

  return (
    <Draggable
      key={props.activity.activity_uuid}
      draggableId={props.activity.activity_uuid}
      index={props.activityIndex}
    >
      {(provided, snapshot) => (
        <div
          className="flex flex-row py-2 my-2 w-full rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 hover:shadow space-x-1 items-center ring-1 ring-inset ring-gray-400/10 shadow-sm"
          key={props.activity.id}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          {/*   Activity Type Icon  */}
          <ActivityTypeIndicator activityType={props.activity.activity_type} />

          {/*   Centered Activity Name  */}
          <div className="grow items-center space-x-2 flex mx-auto justify-center">
            {selectedActivity === props.activity.id ? (
              <div className="chapter-modification-zone text-[7px] text-gray-600 shadow-inner bg-gray-200/60 py-1 px-4 rounded-lg space-x-3">
                <input
                  type="text"
                  className="bg-transparent outline-none text-xs text-gray-500"
                  placeholder="Activity name"
                  value={
                    modifiedActivity
                      ? modifiedActivity?.activityName
                      : props.activity.name
                  }
                  onChange={(e) =>
                    setModifiedActivity({
                      activityId: props.activity.id,
                      activityName: e.target.value,
                    })
                  }
                />
                <button
                  onClick={() => updateActivityName(props.activity.id)}
                  className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900"
                >
                  <Save
                    size={11}
                    onClick={() => updateActivityName(props.activity.id)}
                  />
                </button>
              </div>
            ) : (
              <p className="first-letter:uppercase"> {props.activity.name} </p>
            )}
            <Pencil
              onClick={() => setSelectedActivity(props.activity.id)}
              size={12}
              className="text-neutral-400 hover:cursor-pointer"
            />
          </div>


          {/*   Edit and View Button  */}
          <div className="flex flex-row space-x-2">
            <ActivityElementOptions activity={props.activity} />
            {/*   Publishing  */}
            <div
              className={`hover:cursor-pointer p-1 px-3 border shadow-lg rounded-md font-bold text-xs flex items-center space-x-1 ${!props.activity.published
                ? 'bg-gradient-to-bl text-green-800 from-green-400/50 to-lime-200/80 border-green-600/10 shadow-green-900/10'
                : 'bg-gradient-to-bl text-gray-800 from-gray-400/50 to-gray-200/80 border-gray-600/10 shadow-gray-900/10'
                }`}
              rel="noopener noreferrer"
              onClick={() => changePublicStatus()}
            >
              {!props.activity.published ? (
                <Globe strokeWidth={2} size={12} className="text-green-600" />
              ) : (
                <Lock strokeWidth={2} size={12} className="text-gray-600" />
              )}
              <span>{!props.activity.published ? 'Publish' : 'Unpublish'}</span>
            </div>
            <Link
              href={
                getUriWithOrg(props.orgslug, '') +
                `/course/${props.course_uuid.replace(
                  'course_',
                  ''
                )}/activity/${props.activity.activity_uuid.replace(
                  'activity_',
                  ''
                )}`
              }
              prefetch
              className=" hover:cursor-pointer p-1 px-3 bg-gradient-to-bl text-cyan-800  from-sky-400/50 to-cyan-200/80  border border-cyan-600/10 shadow-cyan-900/10 shadow-lg rounded-md font-bold text-xs flex items-center space-x-1"
              rel="noopener noreferrer"
            >
              <Eye strokeWidth={2} size={12} className="text-sky-600" />
              <span>Preview</span>
            </Link>
          </div>
          {/*   Delete Button  */}
          <div className="flex flex-row pr-3 space-x-1 items-center">
            <MoreVertical size={15} className="text-gray-300" />
            <ConfirmationModal
              confirmationMessage="Are you sure you want to delete this activity ?"
              confirmationButtonText="Delete Activity"
              dialogTitle={'Delete ' + props.activity.name + ' ?'}
              dialogTrigger={
                <div
                  className=" hover:cursor-pointer p-1 px-5 bg-red-600 rounded-md"
                  rel="noopener noreferrer"
                >
                  <X size={15} className="text-rose-200 font-bold" />
                </div>
              }
              functionToExecute={() => deleteActivityUI()}
              status="warning"
            ></ConfirmationModal>
          </div>
        </div>
      )}
    </Draggable>
  )
}

const ActivityTypeIndicator = (props: { activityType: string }) => {
  return (
    <div className="px-3 text-gray-300 space-x-1 w-28">
      {props.activityType === 'TYPE_VIDEO' && (
        <>
          <div className="flex space-x-2 items-center">
            <Video size={16} />{' '}
            <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full mx-auto justify-center align-middle">
              Video
            </div>{' '}
          </div>
        </>
      )}
      {props.activityType === 'TYPE_DOCUMENT' && (
        <>
          <div className="flex space-x-2 items-center">
            <div className="w-[30px]">
              <File size={16} />{' '}
            </div>
            <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">
              Document
            </div>{' '}
          </div>
        </>
      )}
      {props.activityType === 'TYPE_ASSIGNMENT' && (
        <>
          <div className="flex space-x-2 items-center">
            <div className="w-[30px]">
              <Backpack size={16} />{' '}
            </div>
            <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">
              Assignment
            </div>{' '}
          </div>
        </>
      )}
      {props.activityType === 'TYPE_DYNAMIC' && (
        <>
          <div className="flex space-x-2 items-center">
            <Sparkles size={16} />{' '}
            <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full">
              Dynamic
            </div>{' '}
          </div>
        </>
      )}
    </div>
  )
}

const ActivityElementOptions = ({ activity }: any) => {
  const [assignmentUUID, setAssignmentUUID] = useState('');
  const org = useOrg() as any;
  const course = useCourse() as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  async function getAssignmentUUIDFromActivityUUID(activityUUID: string):  Promise<string | undefined> {
    const activity = await getAssignmentFromActivityUUID(activityUUID, access_token);
    if (activity) {
      return activity.data.assignment_uuid;
    }
  }

  const fetchAssignmentUUID = async () => {
    if (activity.activity_type === 'TYPE_ASSIGNMENT') {
      const assignment_uuid = await getAssignmentUUIDFromActivityUUID(activity.activity_uuid);
      if(assignment_uuid)
        setAssignmentUUID(assignment_uuid.replace('assignment_', ''));
    }
  };

  useEffect(() => {
    fetchAssignmentUUID();
  }, [activity, course]);

  return (
    <>
      {activity.activity_type === 'TYPE_DYNAMIC' && (
        <>
          <Link
            href={
              getUriWithOrg(org.slug, '') +
              `/course/${course?.courseStructure.course_uuid.replace(
                'course_',
                ''
              )}/activity/${activity.activity_uuid.replace(
                'activity_',
                ''
              )}/edit`
            }
            prefetch
            className=" hover:cursor-pointer p-1 px-3 bg-sky-700 rounded-md items-center"
            target='_blank' // hotfix for an editor prosemirror bug 
          >
            <div className="text-sky-100 font-bold text-xs flex items-center space-x-1">
              <FilePenLine size={12} /> <span>Edit Page</span>
            </div>
          </Link>
        </>
      )}
      {activity.activity_type === 'TYPE_ASSIGNMENT' && (
        <>
          <Link
            href={
              getUriWithOrg(org.slug, '') +
              `/dash/assignments/${assignmentUUID}`
            }
            prefetch
            className=" hover:cursor-pointer p-1 px-3 bg-teal-700 rounded-md items-center"
          >
            <div className="text-sky-100 font-bold text-xs flex items-center space-x-1">
              <FilePenLine size={12} /> <span>Edit Assignment</span>
            </div>
          </Link>
        </>
      )}
    </>
  );
};

export default ActivityElement
