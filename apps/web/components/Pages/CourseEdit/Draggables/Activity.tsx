import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { Draggable } from '@hello-pangea/dnd'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Eye,
  File,
  MoreVertical,
  Pencil,
  Save,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { mutate } from 'swr'

interface ModifiedActivityInterface {
  activityId: string
  activityName: string
}

function Activity(props: any) {
  const router = useRouter()
  const session = useLHSession() as any
  const [modifiedActivity, setModifiedActivity] = React.useState<
    ModifiedActivityInterface | undefined
  >(undefined)
  const [selectedActivity, setSelectedActivity] = React.useState<
    string | undefined
  >(undefined)

  async function removeActivity() {
    await deleteActivity(props.activity.id, session.data?.tokens?.access_token)
    mutate(`${getAPIUrl()}chapters/meta/course_${props.courseid}`)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateActivityName(activityId: string) {
    if (
      modifiedActivity?.activityId === activityId &&
      selectedActivity !== undefined
    ) {
      const modifiedActivityCopy = {
        ...props.activity,
        name: modifiedActivity.activityName,
      }

      await updateActivity(
        modifiedActivityCopy,
        activityId,
        session.data?.tokens?.access_token
      )
      await mutate(`${getAPIUrl()}chapters/meta/course_${props.courseid}`)
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
    setSelectedActivity(undefined)
  }

  return (
    <Draggable
      key={props.activity.uuid}
      draggableId={String(props.activity.uuid)}
      index={props.index}
    >
      {(provided) => (
        <div
          className="my-2 flex w-auto flex-row items-center space-x-1 rounded-md bg-gray-50 py-2 text-gray-500 shadow-xs ring-1 ring-gray-400/10 transition-all delay-100 duration-75 ease-linear ring-inset hover:scale-102 hover:bg-gray-100 hover:shadow-sm"
          key={props.activity.id}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <div className="w-28 space-x-1 px-3 text-gray-300">
            {props.activity.type === 'video' && (
              <>
                <div className="flex items-center space-x-2">
                  <Video size={16} />{' '}
                  <div className="mx-auto justify-center rounded-full bg-gray-200 px-2 py-1 align-middle text-xs font-bold text-gray-400">
                    Video
                  </div>{' '}
                </div>
              </>
            )}
            {props.activity.type === 'documentpdf' && (
              <>
                <div className="flex items-center space-x-2">
                  <div className="w-[30px]">
                    <File size={16} />{' '}
                  </div>
                  <div className="rounded-full bg-gray-200 px-2 py-1 text-xs font-bold text-gray-400">
                    Document
                  </div>{' '}
                </div>
              </>
            )}
            {props.activity.type === 'dynamic' && (
              <>
                <div className="flex items-center space-x-2">
                  <Sparkles size={16} />{' '}
                  <div className="rounded-full bg-gray-200 px-2 py-1 text-xs font-bold text-gray-400">
                    Dynamic
                  </div>{' '}
                </div>
              </>
            )}
          </div>

          <div className="mx-auto flex grow items-center justify-center space-x-2">
            {selectedActivity === props.activity.id ? (
              <div className="chapter-modification-zone space-x-3 rounded-lg bg-gray-200/60 px-4 py-1 text-[7px] text-gray-600 shadow-inner">
                <input
                  type="text"
                  className="bg-transparent text-xs text-gray-500 outline-hidden"
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

          <div className="flex flex-row space-x-2">
            {props.activity.type === 'TYPE_DYNAMIC' && (
              <>
                <Link
                  href={
                    getUriWithOrg(props.orgslug, '') +
                    `/course/${
                      props.courseid
                    }/activity/${props.activity.uuid.replace(
                      'activity_',
                      ''
                    )}/edit`
                  }
                  className="items-center rounded-md bg-sky-700 p-1 px-3 hover:cursor-pointer"
                  rel="noopener noreferrer"
                >
                  <div className="text-xs font-bold text-sky-100">Edit </div>
                </Link>
              </>
            )}
            <Link
              href={
                getUriWithOrg(props.orgslug, '') +
                `/course/${
                  props.courseid
                }/activity/${props.activity.uuid.replace('activity_', '')}`
              }
              className="rounded-md bg-gray-200 p-1 px-3 hover:cursor-pointer"
              rel="noopener noreferrer"
            >
              <Eye strokeWidth={2} size={15} className="text-gray-600" />
            </Link>
          </div>
          <div className="flex flex-row items-center space-x-1 pr-3">
            <MoreVertical size={15} className="text-gray-300" />
            <ConfirmationModal
              confirmationMessage="Are you sure you want to delete this activity ?"
              confirmationButtonText="Delete Activity"
              dialogTitle={'Delete ' + props.activity.name + ' ?'}
              dialogTrigger={
                <div
                  className="rounded-md bg-red-600 p-1 px-5 hover:cursor-pointer"
                  rel="noopener noreferrer"
                >
                  <X size={15} className="font-bold text-rose-200" />
                </div>
              }
              functionToExecute={() => removeActivity()}
              status="warning"
            ></ConfirmationModal>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default Activity
