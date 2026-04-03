import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Backpack,
  Eye,
  File,
  FilePenLine,
  Globe,
  GripVertical,
  Loader2,
  Lock,
  Package,
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
import { Draggable } from '@hello-pangea/dnd'
import { mutate } from 'swr'
import { deleteAssignmentUsingActivityUUID, getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import toast from 'react-hot-toast'
import { useMediaQuery } from 'usehooks-ts'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [modifiedActivity, setModifiedActivity] = React.useState<
    ModifiedActivityInterface | undefined
  >(undefined)
  const [selectedActivity, setSelectedActivity] = React.useState<
    string | undefined
  >(undefined)
  const [isUpdatingName, setIsUpdatingName] = React.useState<boolean>(false)
  const activityUUID = props.activity.activity_uuid
  const isMobile = useMediaQuery('(max-width: 767px)')
  const course = useCourse() as any;
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  async function deleteActivityUI() {
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.deleting'))
    // Assignments
    if (props.activity.activity_type === 'TYPE_ASSIGNMENT') {
      await deleteAssignmentUsingActivityUUID(props.activity.activity_uuid, access_token)
    }

    await deleteActivity(props.activity.activity_uuid, access_token)
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    // Refresh sidebar cache
    mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
    mutate((key: string) => typeof key === 'string' && key.includes('/assignments/course/'))
    await revalidateTags(['courses'], props.orgslug)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.delete_success'))
    router.refresh()
  }

  async function changePublicStatus() {
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.updating'))
    await updateActivity(
      {
        published: !props.activity.published,
      },
      props.activity.activity_uuid,
      access_token
    )
    mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.update_success'))
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateActivityName(activityId: string) {
    if (
      modifiedActivity?.activityId === activityId &&
      selectedActivity !== undefined
    ) {
      setIsUpdatingName(true)
      
      try {
        await updateActivity({ name: modifiedActivity.activityName }, activityUUID, access_token)
        mutate(`${getAPIUrl()}courses/${props.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
        await revalidateTags(['courses'], props.orgslug)
        toast.success(t('dashboard.courses.structure.activity.toasts.name_update_success'))
        router.refresh()
      } catch (error) {
        toast.error(t('dashboard.courses.structure.activity.toasts.name_update_error'))
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
          className={`flex items-center gap-3 py-2.5 px-3 my-2 w-full rounded-lg text-gray-500
            ${snapshot.isDragging
              ? 'nice-shadow bg-white ring-2 ring-blue-500/20 z-drag-overlay rotate-1 scale-[1.02]'
              : 'nice-shadow bg-white hover:bg-gray-50'
            }`}
          key={props.activity.id}
          {...provided.draggableProps}
          ref={provided.innerRef}
          style={{
            ...provided.draggableProps.style
          }}
        >
          {/* Drag Handle */}
          <div
            {...provided.dragHandleProps}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors"
          >
            <GripVertical size={18} />
          </div>

          {/*   Activity Type Icon  */}
          <ActivityTypeIndicator activityType={props.activity.activity_type} isMobile={isMobile} />

          {/*   Activity Name  */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {selectedActivity === props.activity.id ? (
              <div className="flex items-center gap-2 bg-gray-100 py-1 px-3 rounded-md">
                <input
                  type="text"
                  className="bg-transparent outline-none text-sm text-gray-600 min-w-0"
                  placeholder={t('dashboard.courses.structure.activity.name_placeholder')}
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
                  className="text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isUpdatingName}
                >
                  {isUpdatingName ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                </button>
              </div>
            ) : (
              <p className="first-letter:uppercase text-sm text-gray-600 truncate">{props.activity.name}</p>
            )}
            <button
              onClick={() => !isUpdatingName && setSelectedActivity(props.activity.id)}
              className={`text-gray-300 hover:text-gray-400 flex-shrink-0 ${isUpdatingName ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Pencil size={14} />
            </button>
          </div>

          {/*   Edit, View, Publish, and Delete Buttons  */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ActivityElementOptions activity={props.activity} isMobile={isMobile} />
            {/*   Publishing  */}
            <button
              className={`h-7 px-2 rounded-md text-xs font-bold flex items-center gap-1 transition-colors ${
                !props.activity.published
                  ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 shadow-sm shadow-green-300/20'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 shadow-sm shadow-gray-300/20'
              }`}
              onClick={() => changePublicStatus()}
            >
              {!props.activity.published ? (
                <Globe size={12} />
              ) : (
                <Lock size={12} />
              )}
              <span className="hidden sm:inline">{!props.activity.published ? t('dashboard.courses.structure.actions.publish') : t('dashboard.courses.structure.actions.unpublish')}</span>
            </button>
            <ToolTip content={t('dashboard.courses.structure.actions.preview_activity')} sideOffset={8}>
              <Link
                prefetch={false}
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
                className="h-7 px-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-md flex items-center transition-colors border border-gray-200 shadow-sm shadow-gray-300/20"
                rel="noopener noreferrer"
              >
                <Eye size={12} />
              </Link>
            </ToolTip>
            {/*   Delete Button  */}
            <ConfirmationModal
              confirmationMessage={t('dashboard.courses.structure.modals.delete_activity.message')}
              confirmationButtonText={t('dashboard.courses.structure.modals.delete_activity.button')}
              dialogTitle={t('dashboard.courses.structure.modals.delete_activity.title', { name: props.activity.name })}
              dialogTrigger={
                <button
                  className="h-7 px-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-md flex items-center transition-colors border border-red-200 shadow-sm shadow-red-300/20"
                  rel="noopener noreferrer"
                >
                  <X size={12} />
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
    displayNameKey: 'video',
    Icon: Video
  },
  'TYPE_DOCUMENT': {
    displayNameKey: 'document',
    Icon: File
  },
  'TYPE_ASSIGNMENT': {
    displayNameKey: 'assignment',
    Icon: Backpack
  },
  'TYPE_DYNAMIC': {
    displayNameKey: 'dynamic',
    Icon: Sparkles
  },
  'TYPE_SCORM': {
    displayNameKey: 'scorm',
    Icon: Package
  }
}

const ActivityTypeIndicator = ({activityType, isMobile} : { activityType: keyof typeof ACTIVITIES, isMobile: boolean}) => {
  const { t } = useTranslation()
  const {displayNameKey, Icon} = ACTIVITIES[activityType]

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <Icon className="size-4 text-gray-400" />
      {!isMobile && (
        <span className="text-xs text-gray-400 font-medium">
          {t(`dashboard.courses.structure.activity.types.${displayNameKey}`)}
        </span>
      )}
    </div>
  )
}

const ActivityElementOptions = ({ activity, isMobile }: { activity: any; isMobile: boolean }) => {
  const { t } = useTranslation()
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
          className="h-7 px-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md flex items-center gap-1 text-xs font-bold transition-colors border border-blue-200 shadow-sm shadow-blue-300/20"
          target='_blank'
        >
          <FilePenLine size={12} />
          <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.edit_page')}</span>
        </Link>
      )}
      {activity.activity_type === 'TYPE_ASSIGNMENT' && (
        <Link
          href={
            getUriWithOrg(org.slug, '') +
            `/dash/assignments/${assignmentUUID}`
          }
          className="h-7 px-2 bg-teal-50 text-teal-600 hover:bg-teal-100 rounded-md flex items-center gap-1 text-xs font-bold transition-colors border border-teal-200 shadow-sm shadow-teal-300/20"
        >
          <FilePenLine size={12} />
          <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.edit_assignment')}</span>
        </Link>
      )}
    </>
  );
};

export default ActivityElement
