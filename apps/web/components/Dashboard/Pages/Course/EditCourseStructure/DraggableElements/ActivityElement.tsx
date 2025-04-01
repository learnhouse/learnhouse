import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { Draggable } from '@hello-pangea/dnd'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import {
  deleteAssignmentUsingActivityUUID,
  getAssignmentFromActivityUUID,
} from '@services/courses/assignments'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Backpack,
  Eye,
  File,
  FilePenLine,
  Globe,
  Loader2,
  Lock,
  Pencil,
  Save,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useMediaQuery } from 'usehooks-ts'

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
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [modifiedActivity, setModifiedActivity] = React.useState<
    ModifiedActivityInterface | undefined
  >(undefined)
  const [selectedActivity, setSelectedActivity] = React.useState<
    string | undefined
  >(undefined)
  const [isUpdatingName, setIsUpdatingName] = React.useState<boolean>(false)
  const activityUUID = props.activity.activity_uuid
  const isMobile = useMediaQuery('(max-width: 767px)')

  async function deleteActivityUI() {
    const toast_loading = toast.loading('Deleting activity...')
    // Assignments
    if (props.activity.activity_type === 'TYPE_ASSIGNMENT') {
      await deleteAssignmentUsingActivityUUID(
        props.activity.activity_uuid,
        access_token
      )
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
      setIsUpdatingName(true)

      const modifiedActivityCopy = {
        ...props.activity,
        name: modifiedActivity.activityName,
      }

      try {
        await updateActivity(modifiedActivityCopy, activityUUID, access_token)
        mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta`)
        await revalidateTags(['courses'], props.orgslug)
        toast.success('Activity name updated successfully')
        router.refresh()
      } catch (error) {
        toast.error('Failed to update activity name')
        console.error('Error updating activity name:', error)
      } finally {
        setIsUpdatingName(false)
        setSelectedActivity(undefined)
      }
    } else {
      setSelectedActivity(undefined)
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
          className="nice-shadow my-2 flex w-full flex-col items-center space-y-2 rounded-md border-1 border-gray-200 bg-gray-50 px-3 py-2 text-gray-500 shadow-md transition-all duration-200 hover:scale-102 hover:bg-gray-100 sm:flex-row sm:space-y-0 sm:space-x-2"
          key={props.activity.id}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          {/*   Activity Type Icon  */}
          <ActivityTypeIndicator
            activityType={props.activity.activity_type}
            isMobile={isMobile}
          />

          {/*   Centered Activity Name  */}
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
                  disabled={isUpdatingName}
                />
                <button
                  onClick={() => updateActivityName(props.activity.id)}
                  className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isUpdatingName}
                >
                  {isUpdatingName ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Save size={12} />
                  )}
                </button>
              </div>
            ) : (
              <p className="text-center first-letter:uppercase sm:text-left">
                {' '}
                {props.activity.name}{' '}
              </p>
            )}
            <Pencil
              onClick={() =>
                !isUpdatingName && setSelectedActivity(props.activity.id)
              }
              className={`size-3 min-w-3 text-neutral-400 hover:cursor-pointer ${isUpdatingName ? 'cursor-not-allowed opacity-50' : ''}`}
            />
          </div>

          {/*   Edit, View, Publish, and Delete Buttons  */}
          <div className="flex w-full flex-wrap justify-center gap-2 sm:w-auto sm:justify-end">
            <ActivityElementOptions
              activity={props.activity}
              isMobile={isMobile}
            />
            {/*   Publishing  */}
            <button
              className={`flex items-center space-x-1 rounded-md border p-1 px-2 text-xs font-bold shadow-md transition-colors duration-200 sm:px-3 ${
                !props.activity.published
                  ? 'border-green-600/10 bg-linear-to-bl from-green-400/50 to-lime-200/80 text-green-800 hover:from-green-500/50 hover:to-lime-300/80'
                  : 'border-gray-600/10 bg-linear-to-bl from-gray-400/50 to-gray-200/80 text-gray-800 hover:from-gray-500/50 hover:to-gray-300/80'
              }`}
              onClick={() => changePublicStatus()}
            >
              {!props.activity.published ? (
                <Globe strokeWidth={2} size={12} className="text-green-600" />
              ) : (
                <Lock strokeWidth={2} size={12} className="text-gray-600" />
              )}
              <span>{!props.activity.published ? 'Publish' : 'Unpublish'}</span>
            </button>
            <div className="mx-1 hidden h-3 w-px self-center rounded-full bg-gray-300 sm:block" />
            <ToolTip content="Preview Activity" sideOffset={8}>
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
                className="flex items-center space-x-1 rounded-md border border-cyan-600/10 bg-linear-to-bl from-sky-400/50 to-cyan-200/80 p-1 px-2 text-xs font-bold text-cyan-800 shadow-md transition-colors duration-200 hover:from-sky-500/50 hover:to-cyan-300/80 sm:px-3"
                rel="noopener noreferrer"
              >
                <Eye strokeWidth={2} size={14} className="text-sky-600" />
              </Link>
            </ToolTip>
            {/*   Delete Button  */}
            <ConfirmationModal
              confirmationMessage="Are you sure you want to delete this activity ?"
              confirmationButtonText="Delete Activity"
              dialogTitle={'Delete ' + props.activity.name + ' ?'}
              dialogTrigger={
                <button
                  className="flex items-center space-x-1 rounded-md bg-red-600 p-1 px-2 shadow-md transition-colors duration-200 hover:bg-red-700 sm:px-3"
                  rel="noopener noreferrer"
                >
                  <X size={15} className="font-bold text-rose-200" />
                </button>
              }
              functionToExecute={() => deleteActivityUI()}
              status="warning"
            />
          </div>
        </div>
      )}
    </Draggable>
  )
}

const ACTIVITIES = {
  TYPE_VIDEO: {
    displayName: 'Video',
    Icon: Video,
  },
  TYPE_DOCUMENT: {
    displayName: 'Document',
    Icon: File,
  },
  TYPE_ASSIGNMENT: {
    displayName: 'Assignment',
    Icon: Backpack,
  },
  TYPE_DYNAMIC: {
    displayName: 'Dynamic',
    Icon: Sparkles,
  },
}

const ActivityTypeIndicator = ({
  activityType,
  isMobile,
}: {
  activityType: keyof typeof ACTIVITIES
  isMobile: boolean
}) => {
  const { displayName, Icon } = ACTIVITIES[activityType]

  return (
    <div
      className={`flex w-28 space-x-1 text-gray-300 ${isMobile ? 'flex-col' : ''}`}
    >
      <div className="flex items-center space-x-2">
        <Icon className="size-4" />{' '}
        <div className="mx-auto justify-center rounded-full bg-gray-200 px-2 py-1 align-middle text-xs font-bold text-gray-400">
          {displayName}
        </div>{' '}
      </div>
    </div>
  )
}

const ActivityElementOptions = ({
  activity,
  isMobile,
}: {
  activity: any
  isMobile: boolean
}) => {
  const [assignmentUUID, setAssignmentUUID] = useState('')
  const org = useOrg() as any
  const course = useCourse() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  async function getAssignmentUUIDFromActivityUUID(
    activityUUID: string
  ): Promise<string | undefined> {
    const activity = await getAssignmentFromActivityUUID(
      activityUUID,
      access_token
    )
    if (activity) {
      return activity.data.assignment_uuid
    }
  }

  const fetchAssignmentUUID = async () => {
    if (activity.activity_type === 'TYPE_ASSIGNMENT') {
      const assignment_uuid = await getAssignmentUUIDFromActivityUUID(
        activity.activity_uuid
      )
      if (assignment_uuid)
        setAssignmentUUID(assignment_uuid.replace('assignment_', ''))
    }
  }

  useEffect(() => {
    fetchAssignmentUUID()
  }, [activity, course])

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
            className={`p-1 hover:cursor-pointer ${isMobile ? 'px-2' : 'px-3'} items-center rounded-md bg-sky-700`}
            target="_blank"
          >
            <div className="flex items-center space-x-1 text-xs font-bold text-sky-100">
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
            className={`p-1 hover:cursor-pointer ${isMobile ? 'px-2' : 'px-3'} items-center rounded-md bg-teal-700`}
          >
            <div className="flex items-center space-x-1 text-xs font-bold text-sky-100">
              <FilePenLine size={12} />{' '}
              {!isMobile && <span>Edit Assignment</span>}
            </div>
          </Link>
        </>
      )}
    </>
  )
}

export default ActivityElement
