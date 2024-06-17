import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Eye,
  File,
  FilePenLine,
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
import React from 'react'
import { Draggable } from 'react-beautiful-dnd'
import { mutate } from 'swr'

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
    await deleteActivity(props.activity.activity_uuid, access_token)
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateActivityName(activityId: string) {
    if (
      modifiedActivity?.activityId === activityId &&
      selectedActivity !== undefined
    ) {
      setSelectedActivity(undefined)
      let modifiedActivityCopy = {
        name: modifiedActivity.activityName,
        description: '',
        type: props.activity.type,
        content: props.activity.content,
      }

      await updateActivity(modifiedActivityCopy, activityUUID, access_token)
      mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
  }

  return (
    <Draggable
      key={props.activity.activity_uuid}
      draggableId={props.activity.activity_uuid}
      index={props.activityIndex}
    >
      {(provided, snapshot) => (
        <div
          className="flex flex-row py-2 my-2 w-full rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 hover:shadow space-x-1 items-center ring-1 ring-inset ring-gray-400/10 shadow-sm transition-all delay-100 duration-75 ease-linear"
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
            {props.activity.activity_type === 'TYPE_DYNAMIC' && (
              <>
                <Link
                  href={
                    getUriWithOrg(props.orgslug, '') +
                    `/course/${props.course_uuid.replace(
                      'course_',
                      ''
                    )}/activity/${props.activity.activity_uuid.replace(
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
              className=" hover:cursor-pointer p-1 px-3 bg-gray-200 rounded-md font-bold text-xs flex items-center space-x-1"
              rel="noopener noreferrer"
            >
              <Eye strokeWidth={2} size={12} className="text-gray-600" />
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
export default ActivityElement
