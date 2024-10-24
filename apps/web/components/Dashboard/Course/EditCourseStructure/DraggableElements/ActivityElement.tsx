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
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [modifiedActivity, setModifiedActivity] = React.useState<
    ModifiedActivityInterface | undefined
  >(undefined)
  const [selectedActivity, setSelectedActivity] = React.useState<
    string | undefined
  >(undefined)
  const activityUUID = props.activity.activity_uuid
  const isMobile = useMediaQuery('(max-width: 767px)')

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
          className="flex flex-col sm:flex-row py-2 px-3 my-2 w-full rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:scale-102 space-y-2 sm:space-y-0 sm:space-x-2 items-center ring-1 ring-inset ring-gray-400/10 nice-shadow"
          key={props.activity.id}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          {/*   Activity Type Icon  */}
          <ActivityTypeIndicator activityType={props.activity.activity_type} isMobile={isMobile} />

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
                  <Save size={12} />
                </button>
              </div>
            ) : (
              <p className="first-letter:uppercase text-center sm:text-left"> {props.activity.name} </p>
            )}
            <Pencil
              onClick={() => setSelectedActivity(props.activity.id)}
              className="text-neutral-400 hover:cursor-pointer size-3 min-w-3"
            />
          </div>

          {/*   Edit, View, Publish, and Delete Buttons  */}
          <div className="flex flex-wrap justify-center sm:justify-end gap-2 w-full sm:w-auto">
            <ActivityElementOptions activity={props.activity} isMobile={isMobile} />
            {/*   Publishing  */}
            <button
              className={`p-1 px-2 sm:px-3 border shadow-md rounded-md font-bold text-xs flex items-center space-x-1 transition-colors duration-200 ${
                !props.activity.published
                  ? 'bg-gradient-to-bl text-green-800 from-green-400/50 to-lime-200/80 border-green-600/10 hover:from-green-500/50 hover:to-lime-300/80'
                  : 'bg-gradient-to-bl text-gray-800 from-gray-400/50 to-gray-200/80 border-gray-600/10 hover:from-gray-500/50 hover:to-gray-300/80'
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
              className="p-1 px-2 sm:px-3 bg-gradient-to-bl text-cyan-800 from-sky-400/50 to-cyan-200/80 border border-cyan-600/10 shadow-md rounded-md font-bold text-xs flex items-center space-x-1 transition-colors duration-200 hover:from-sky-500/50 hover:to-cyan-300/80"
              rel="noopener noreferrer"
            >
              <Eye strokeWidth={2} size={12} className="text-sky-600" />
              <span>Preview</span>
            </Link>
            {/*   Delete Button  */}
            <ConfirmationModal
              confirmationMessage="Are you sure you want to delete this activity ?"
              confirmationButtonText="Delete Activity"
              dialogTitle={'Delete ' + props.activity.name + ' ?'}
              dialogTrigger={
                <button
                  className="p-1 px-2 sm:px-3 bg-red-600 rounded-md flex items-center space-x-1 shadow-md transition-colors duration-200 hover:bg-red-700"
                  rel="noopener noreferrer"
                >
                  <X size={15} className="text-rose-200 font-bold" />
                  {!isMobile && <span className="text-rose-200 font-bold text-xs">Delete</span>}
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
  'TYPE_VIDEO': {
    displayName: 'Video',
    Icon: Video
  },
  'TYPE_DOCUMENT': {
    displayName: 'Document',
    Icon: File
  },
  'TYPE_ASSIGNMENT': {
    displayName: 'Assignment',
    Icon: Backpack
  },
  'TYPE_DYNAMIC': {
    displayName: 'Dynamic',
    Icon: Sparkles
  }
}

const ActivityTypeIndicator = ({activityType, isMobile} : { activityType: keyof typeof ACTIVITIES, isMobile: boolean}) => {
  const {displayName, Icon} = ACTIVITIES[activityType]

  return (
    <div className={`px-3 text-gray-300 space-x-1 w-28 flex ${isMobile ? 'flex-col' : ''}`}>
      <div className="flex space-x-2 items-center">
            <Icon className="size-4" />{' '}
            <div className="text-xs bg-gray-200 text-gray-400 font-bold px-2 py-1 rounded-full mx-auto justify-center align-middle">
              {displayName}
            </div>{' '}
          </div>
    </div>
  )
}

const ActivityElementOptions = ({ activity, isMobile }: { activity: any; isMobile: boolean }) => {
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
            className={`hover:cursor-pointer p-1 ${isMobile ? 'px-2' : 'px-3'} bg-sky-700 rounded-md items-center`}
            target='_blank'
          >
            <div className="text-sky-100 font-bold text-xs flex items-center space-x-1">
              <FilePenLine size={12} />  <span>Edit Page</span>
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
            className={`hover:cursor-pointer p-1 ${isMobile ? 'px-2' : 'px-3'} bg-teal-700 rounded-md items-center`}
          >
            <div className="text-sky-100 font-bold text-xs flex items-center space-x-1">
              <FilePenLine size={12} /> {!isMobile && <span>Edit Assignment</span>}
            </div>
          </Link>
        </>
      )}
    </> 
  );
};

export default ActivityElement
