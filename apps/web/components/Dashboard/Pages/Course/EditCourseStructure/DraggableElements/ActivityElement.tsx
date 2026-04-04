import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Backpack,
  Check,
  Eye,
  File,
  FilePenLine,
  Globe,
  GripVertical,
  Loader2,
  Lock,
  MoreVertical,
  Package,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import { MarkdownLogo, Globe as GlobePhosphor } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { mutate } from 'swr'
import { deleteAssignmentUsingActivityUUID, getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse, useCourseDispatch, getCourseMetaCacheKey } from '@components/Contexts/CourseContext'
import toast from 'react-hot-toast'
import { useMediaQuery } from 'usehooks-ts'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

type ActivitiyElementProps = {
  orgslug: string
  activity: any
  activityIndex: any
  course_uuid: string
  isSelected?: boolean
  onToggleSelect?: () => void
  selectionMode?: boolean
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
  const [isPublishing, setIsPublishing] = React.useState<boolean>(false)
  const [deleteModalOpen, setDeleteModalOpen] = React.useState(false)
  const activityUUID = props.activity.activity_uuid
  const isMobile = useMediaQuery('(max-width: 767px)')
  const org = useOrg() as any;
  const course = useCourse() as any;
  const dispatchCourse = useCourseDispatch() as any;
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  // Assignment UUID for edit link
  const [assignmentUUID, setAssignmentUUID] = useState('');
  useEffect(() => {
    if (props.activity.activity_type === 'TYPE_ASSIGNMENT') {
      getAssignmentFromActivityUUID(props.activity.activity_uuid, access_token).then((result) => {
        if (result?.data?.assignment_uuid) {
          setAssignmentUUID(result.data.assignment_uuid.replace('assignment_', ''))
        }
      })
    }
  }, [props.activity, course])

  async function deleteActivityUI() {
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.deleting'))
    if (props.activity.activity_type === 'TYPE_ASSIGNMENT') {
      await deleteAssignmentUsingActivityUUID(props.activity.activity_uuid, access_token)
    }
    await deleteActivity(props.activity.activity_uuid, access_token)
    const updatedStructure = {
      ...course.courseStructure,
      chapters: course.courseStructure.chapters.map((ch: any) => ({
        ...ch,
        activities: ch.activities.filter((a: any) => a.activity_uuid !== props.activity.activity_uuid),
      })),
    }
    dispatchCourse({ type: 'setCourseStructure', payload: updatedStructure })
    dispatchCourse({ type: 'setIsSaved' })
    mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
    mutate((key: string) => typeof key === 'string' && key.includes('/assignments/course/'))
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.delete_success'))
    revalidateTags(['courses'], props.orgslug)
  }

  async function changePublicStatus() {
    const newPublished = !props.activity.published
    setIsPublishing(true)
    try {
      const result = await updateActivity(
        { published: newPublished },
        props.activity.activity_uuid,
        access_token
      )
      if (result.success) {
        const updatedStructure = {
          ...course.courseStructure,
          chapters: course.courseStructure.chapters.map((ch: any) => ({
            ...ch,
            activities: ch.activities.map((a: any) =>
              a.activity_uuid === props.activity.activity_uuid
                ? { ...a, published: newPublished }
                : a
            ),
          })),
        }
        dispatchCourse({ type: 'setCourseStructure', payload: updatedStructure })
        dispatchCourse({ type: 'setIsSaved' })
        toast.success(t('dashboard.courses.structure.activity.toasts.update_success'))
        revalidateTags(['courses'], props.orgslug)
      } else {
        toast.error(t('dashboard.courses.structure.activity.toasts.update_error'))
      }
    } finally {
      setIsPublishing(false)
    }
  }

  async function updateActivityName(activityId: string) {
    if (
      modifiedActivity?.activityId === activityId &&
      selectedActivity !== undefined
    ) {
      setIsUpdatingName(true)
      try {
        await updateActivity({ name: modifiedActivity.activityName }, activityUUID, access_token)
        await mutate(getCourseMetaCacheKey(props.course_uuid, withUnpublishedActivities), undefined, { revalidate: true })
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

  const editHref = props.activity.activity_type === 'TYPE_DYNAMIC'
    ? getUriWithOrg(org?.slug || props.orgslug, '') +
      `/course/${course?.courseStructure.course_uuid.replace('course_', '')}/activity/${props.activity.activity_uuid.replace('activity_', '')}/edit`
    : props.activity.activity_type === 'TYPE_ASSIGNMENT'
    ? getUriWithOrg(org?.slug || props.orgslug, '') + `/dash/assignments/${assignmentUUID}`
    : null

  const previewHref = getUriWithOrg(props.orgslug, '') +
    `/course/${props.course_uuid.replace('course_', '')}/activity/${props.activity.activity_uuid.replace('activity_', '')}`

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
              : props.isSelected
              ? 'nice-shadow bg-blue-50 ring-1 ring-blue-200'
              : 'nice-shadow bg-white hover:bg-gray-50'
            }`}
          key={props.activity.id}
          {...provided.draggableProps}
          ref={provided.innerRef}
          style={{ ...provided.draggableProps.style }}
        >
          {/* Selection checkbox */}
          <button
            onClick={(e) => { e.stopPropagation(); props.onToggleSelect?.() }}
            className={`flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
              props.isSelected
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-300 bg-white hover:border-blue-400'
            }`}
          >
            {props.isSelected && <Check size={12} strokeWidth={3} />}
          </button>

          {/* Drag Handle */}
          <div
            {...provided.dragHandleProps}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors"
          >
            <GripVertical size={18} />
          </div>

          {/* Activity Type Icon */}
          <ActivityTypeIndicator activityType={props.activity.activity_type} activitySubType={props.activity.activity_sub_type} isMobile={isMobile} />

          {/* Activity Name */}
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
          </div>

          {/* Status badge + quick actions */}
          {!props.selectionMode && (
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium w-[90px] justify-center ${
                props.activity.published
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-gray-100 text-gray-500 border border-gray-200'
              }`}>
                {isPublishing ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : props.activity.published ? (
                  <Globe size={10} />
                ) : (
                  <Lock size={10} />
                )}
                {props.activity.published
                  ? t('dashboard.courses.structure.activity.status.published')
                  : t('dashboard.courses.structure.activity.status.draft')}
              </span>
              <div className="flex items-center gap-1">
              {editHref ? (
                <Link
                  href={editHref}
                  target="_blank"
                  className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title={props.activity.activity_type === 'TYPE_ASSIGNMENT'
                    ? t('dashboard.courses.structure.actions.edit_assignment')
                    : t('dashboard.courses.structure.actions.edit_page')}
                >
                  <FilePenLine size={15} />
                </Link>
              ) : (
                <div className="h-7 w-7" />
              )}
              <Link
                href={previewHref}
                className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={t('dashboard.courses.structure.actions.preview_activity')}
              >
                <Eye size={15} />
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setSelectedActivity(props.activity.id)}>
                    <Pencil size={14} />
                    {t('dashboard.courses.structure.actions.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={changePublicStatus} disabled={isPublishing}>
                    {props.activity.published ? <Lock size={14} /> : <Globe size={14} />}
                    {props.activity.published
                      ? t('dashboard.courses.structure.actions.unpublish')
                      : t('dashboard.courses.structure.actions.publish')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault()
                      setDeleteModalOpen(true)
                    }}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    <Trash2 size={14} />
                    {t('dashboard.courses.structure.bulk_actions.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>
          )}

          {/* Delete confirmation modal - hidden trigger clicked from dropdown */}
          <ConfirmationModal
            confirmationMessage={t('dashboard.courses.structure.modals.delete_activity.message')}
            confirmationButtonText={t('dashboard.courses.structure.modals.delete_activity.button')}
            dialogTitle={t('dashboard.courses.structure.modals.delete_activity.title', { name: props.activity.name })}
            functionToExecute={() => deleteActivityUI()}
            status="warning"
            dialogTrigger={
              <button ref={(el) => { if (deleteModalOpen && el) { el.click(); setDeleteModalOpen(false) } }} className="hidden" />
            }
          />
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

const ActivityTypeIndicator = ({activityType, activitySubType, isMobile} : { activityType: keyof typeof ACTIVITIES, activitySubType?: string, isMobile: boolean}) => {
  const { t } = useTranslation()
  const isMarkdown = activitySubType === 'SUBTYPE_DYNAMIC_MARKDOWN'
  const isEmbed = activitySubType === 'SUBTYPE_DYNAMIC_EMBED'
  const {displayNameKey, Icon} = isMarkdown
    ? { displayNameKey: 'markdown', Icon: MarkdownLogo }
    : isEmbed
    ? { displayNameKey: 'embed', Icon: GlobePhosphor }
    : ACTIVITIES[activityType]

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

export default ActivityElement
