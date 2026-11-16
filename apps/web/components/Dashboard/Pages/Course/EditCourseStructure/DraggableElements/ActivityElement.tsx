import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import EditVideoActivityModal from '@components/Objects/Modals/Activities/Edit/EditVideoActivityModal'
import EditDocumentActivityModal from '@components/Objects/Modals/Activities/Edit/EditDocumentActivityModal'
import EditScormActivityModal from '@components/Objects/Modals/Activities/Edit/EditScormActivityModal'
import { getUriWithOrg } from '@services/config/config'
import {
  addUserGroupToActivity,
  deleteActivity,
  getActivityUserGroups,
  removeUserGroupFromActivity,
  updateActivity,
} from '@services/courses/activities'
import { revalidateTags } from '@services/utils/ts/requests'
import LockPopover, { LockType } from './LockPopover'
import { MarkdownLogo, Globe as GlobePhosphor, Cube, Backpack, Eye, EyeSlash, File, PencilSimpleLine, Globe, DotsSixVertical, CircleNotch, DotsThreeVertical, Lightning, Package, PencilSimple, PuzzlePiece, Radio, Browsers, Trash, VideoCamera } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { prefetchActivityEditor } from '@components/Objects/Editor/editorPrefetch'
import React, { useEffect, useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import { deleteAssignmentUsingActivityUUID, getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
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
import { ActivityPreviewHoverCard } from '@components/Objects/Activities/ActivityPreview/ActivityPreview'
import { AtlasItemMenu } from '@ee/components/Atlas/CourseAtlas'
import { SelectBox } from '../../courseEditorUi'
import { ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useRenameDraft } from '../useRenameDraft'
import { InlineNameEditor } from './InlineNameEditor'
import { useModalFormHost } from '@components/Objects/Modals/Activities/activityFormKit'
import dynamic from 'next/dynamic'

// Play activities link an EE play (`@ee` is a stub in open-source builds).
const PlayActivityEditModal = dynamic(() => import('@ee/components/Plays/course/PlayActivityEditModal'), { ssr: false })

type ActivitiyElementProps = {
  orgslug: string
  activity: any
  activityIndex: any
  course_uuid: string
  chapter_id?: number
  chapter_name?: string
  isSelected?: boolean
  onToggleSelect?: () => void
  selectionMode?: boolean
}

function ActivityElement(props: ActivitiyElementProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [isRenaming, setIsRenaming] = React.useState(false)
  const renames = useRenameDraft()
  // One host is enough: only one edit modal can be open at a time.
  const editHost = useModalFormHost()
  const activityName = renames.activityName(props.activity.activity_uuid, props.activity.name)
  const [isPublishing, setIsPublishing] = React.useState<boolean>(false)
  const [deleteModalOpen, setDeleteModalOpen] = React.useState(false)
  const [editVideoModalOpen, setEditVideoModalOpen] = React.useState(false)
  const [editDocumentModalOpen, setEditDocumentModalOpen] = React.useState(false)
  const [editScormModalOpen, setEditScormModalOpen] = React.useState(false)
  const [editPlayModalOpen, setEditPlayModalOpen] = React.useState(false)
  const activityUUID = props.activity.activity_uuid
  const isMobile = useMediaQuery('(max-width: 767px)')
  const org = useOrg() as any;
  const course = useCourse() as any;
  const dispatchCourse = useCourseDispatch() as any;
  const _withUnpublishedActivities = course ? course.withUnpublishedActivities : false
  const queryClient = useQueryClient()
  const cleanCourseUuid = (id: string) => id?.replace(/^course_/, '') ?? id

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
    // Server-confirmed: patch without touching other unsaved edits.
    dispatchCourse({ type: 'patchStructure', payload: { chapters: updatedStructure.chapters } })
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.delete_success'))
    revalidateTags(['courses'], props.orgslug)
  }

  async function changeLockType(next: LockType) {
    try {
      const result = await updateActivity({ lock_type: next }, activityUUID, access_token)
      if (result.success === false) {
        toast.error(t('dashboard.courses.structure.activity.toasts.update_error'))
        return
      }
      const updatedStructure = {
        ...course.courseStructure,
        chapters: course.courseStructure.chapters.map((ch: any) => ({
          ...ch,
          activities: ch.activities.map((a: any) =>
            a.activity_uuid === activityUUID ? { ...a, lock_type: next } : a
          ),
        })),
      }
      dispatchCourse({ type: 'patchStructure', payload: { chapters: updatedStructure.chapters } })
      toast.success(t('dashboard.courses.structure.activity.toasts.update_success'))
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(t('dashboard.courses.structure.activity.toasts.update_error'))
    }
  }

  async function fetchActivityUserGroups() {
    const groups = await getActivityUserGroups(activityUUID, access_token)
    return Array.isArray(groups) ? groups : []
  }

  async function addActivityUserGroup(usergroup_uuid: string) {
    await addUserGroupToActivity(activityUUID, usergroup_uuid, access_token)
  }

  async function removeActivityUserGroup(usergroup_uuid: string) {
    await removeUserGroupFromActivity(activityUUID, usergroup_uuid, access_token)
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
        dispatchCourse({ type: 'patchStructure', payload: { chapters: updatedStructure.chapters } })
        toast.success(t('dashboard.courses.structure.activity.toasts.update_success'))
        await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
        revalidateTags(['courses'], props.orgslug)
      } else {
        toast.error(t('dashboard.courses.structure.activity.toasts.update_error'))
      }
    } finally {
      setIsPublishing(false)
    }
  }

  const router = useRouter()
  const editHref = props.activity.activity_type === 'TYPE_DYNAMIC'
    ? getUriWithOrg(org?.slug || props.orgslug, '') +
      `/course/${course?.courseStructure.course_uuid.replace('course_', '')}/activity/${props.activity.activity_uuid.replace('activity_', '')}/edit`
    : props.activity.activity_type === 'TYPE_ASSIGNMENT'
    ? getUriWithOrg(org?.slug || props.orgslug, '') + `/dash/assignments/${assignmentUUID}`
    : props.activity.activity_type === 'TYPE_LIVE_SESSION' && props.activity.content?.live_session_uuid
    ? getUriWithOrg(org?.slug || props.orgslug, '') +
      `/dash/live-sessions/session/${String(props.activity.content.live_session_uuid).replace(/^livesession_/, '')}/general`
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
          className={`group flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 py-2 px-3 mb-1.5 w-full rounded-xl text-neutral-500 transition-colors
            ${snapshot.isDragging
              ? 'bg-white shadow-xl ring-2 ring-neutral-900/10 z-drag-overlay rotate-1 scale-[1.02]'
              : props.isSelected
              ? 'bg-neutral-50 ring-1 ring-inset ring-neutral-900/20'
              : 'bg-white ring-1 ring-inset ring-neutral-200/70 hover:ring-neutral-300 hover:bg-neutral-50/60'
            }`}
          key={props.activity.id}
          {...provided.draggableProps}
          ref={provided.innerRef}
          style={{ ...provided.draggableProps.style }}
        >
          {/* Selection checkbox */}
          <SelectBox
            checked={!!props.isSelected}
            onClick={(e) => { e.stopPropagation(); props.onToggleSelect?.() }}
          />

          {/* Drag Handle */}
          <div
            {...provided.dragHandleProps}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 transition-colors p-1.5 -m-1.5 sm:p-0 sm:m-0 touch-none"
          >
            <DotsSixVertical size={18} />
          </div>

          {/* Activity Type Icon */}
          <ActivityTypeIndicator activityType={props.activity.activity_type} activitySubType={props.activity.activity_sub_type} isMobile={isMobile} />

          {/* Activity Name */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {isRenaming ? (
              <InlineNameEditor
                initial={activityName}
                placeholder={t('dashboard.courses.structure.activity.name_placeholder')}
                onCommit={(name) => {
                  renames.renameActivity(props.activity.activity_uuid, name, props.activity.name)
                  setIsRenaming(false)
                }}
                onCancel={() => setIsRenaming(false)}
                className="text-sm font-medium flex-1"
              />
            ) : (
              <>
                <ActivityPreviewHoverCard activity={props.activity}>
                  <p
                    className="text-sm font-medium text-neutral-800 truncate cursor-default"
                    onDoubleClick={() => setIsRenaming(true)}
                  >
                    {activityName}
                  </p>
                </ActivityPreviewHoverCard>
                {renames.isActivityRenamed(props.activity.activity_uuid) && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                    title={t('dashboard.courses.save.unsaved')}
                    aria-label={t('dashboard.courses.save.unsaved')}
                  />
                )}
              </>
            )}
          </div>

          {/* Status badge + quick actions; their own row under the name on phones */}
          {!props.selectionMode && (
            <div className="flex items-center gap-2 flex-shrink-0 ms-auto basis-full sm:basis-auto justify-between sm:justify-start ps-[3.75rem] sm:ps-0">
              <button
                onClick={changePublicStatus}
                disabled={isPublishing}
                title={props.activity.published
                  ? t('dashboard.courses.structure.actions.unpublish')
                  : t('dashboard.courses.structure.actions.publish')}
                className={`flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-semibold min-w-[84px] justify-center transition-colors ${
                  isPublishing
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer'
                } ${
                  props.activity.published
                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700'
                }`}
              >
                {isPublishing ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : props.activity.published ? (
                  <Globe size={10} />
                ) : (
                  <EyeSlash size={10} />
                )}
                <span>
                  {props.activity.published
                    ? t('dashboard.courses.structure.activity.status.published')
                    : t('dashboard.courses.structure.activity.status.draft')}
                </span>
              </button>
              <div className="hidden sm:block w-px h-5 bg-neutral-200 mx-0.5" />
              <div className="flex items-center gap-1">
              <AtlasItemMenu
                activity={{
                  uuid: props.activity.activity_uuid,
                  name: activityName,
                  type: props.activity.activity_type,
                  chapter: props.chapter_name ? { name: props.chapter_name, id: props.chapter_id } : undefined,
                }}
              />
              {props.activity.activity_type === 'TYPE_VIDEO' ? (
                <Modal
                  isDialogOpen={editVideoModalOpen}
                  onOpenChange={() => setEditVideoModalOpen(!editVideoModalOpen)}
                  size="lg"
                  icon={<VideoCamera size={16} />}
                  dialogTitle={t('dashboard.courses.structure.activity.edit_modals.video_title')}
                  dialogDescription={t('dashboard.courses.structure.activity.edit_modals.video_description')}
                  preventClose={editHost.submitting}
                  footer={editHost.footer(() => setEditVideoModalOpen(false), t('common.cancel'))}
                  dialogContent={editHost.wrap(
                    <EditVideoActivityModal
                      activity={props.activity}
                      courseUuid={props.course_uuid}
                      orgSlug={props.orgslug}
                      onClose={() => setEditVideoModalOpen(false)}
                    />
                  )}
                  dialogTrigger={
                    <button
                      className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                      title={t('dashboard.courses.structure.activity.edit_modals.video_button')}
                    >
                      <PencilSimpleLine size={15} />
                    </button>
                  }
                />
              ) : props.activity.activity_type === 'TYPE_DOCUMENT' ? (
                <Modal
                  isDialogOpen={editDocumentModalOpen}
                  onOpenChange={() => setEditDocumentModalOpen(!editDocumentModalOpen)}
                  size="md"
                  icon={<File size={16} />}
                  dialogTitle={t('dashboard.courses.structure.activity.edit_modals.document_title')}
                  dialogDescription={t('dashboard.courses.structure.activity.edit_modals.document_description')}
                  preventClose={editHost.submitting}
                  footer={editHost.footer(() => setEditDocumentModalOpen(false), t('common.cancel'))}
                  dialogContent={editHost.wrap(
                    <EditDocumentActivityModal
                      activity={props.activity}
                      courseUuid={props.course_uuid}
                      orgSlug={props.orgslug}
                      onClose={() => setEditDocumentModalOpen(false)}
                    />
                  )}
                  dialogTrigger={
                    <button
                      className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                      title={t('dashboard.courses.structure.activity.edit_modals.document_button')}
                    >
                      <PencilSimpleLine size={15} />
                    </button>
                  }
                />
              ) : props.activity.activity_type === 'TYPE_SCORM' ? (
                <Modal
                  isDialogOpen={editScormModalOpen}
                  onOpenChange={() => setEditScormModalOpen(!editScormModalOpen)}
                  size="md"
                  icon={<Package size={16} />}
                  dialogTitle={t('dashboard.courses.structure.activity.edit_modals.scorm_title')}
                  dialogDescription={t('dashboard.courses.structure.activity.edit_modals.scorm_description')}
                  preventClose={editHost.submitting}
                  footer={editHost.footer(() => setEditScormModalOpen(false), t('common.cancel'))}
                  dialogContent={editHost.wrap(
                    <EditScormActivityModal
                      activity={props.activity}
                      courseUuid={props.course_uuid}
                      orgSlug={props.orgslug}
                      onClose={() => setEditScormModalOpen(false)}
                    />
                  )}
                  dialogTrigger={
                    <button
                      className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                      title={t('dashboard.courses.structure.activity.edit_modals.scorm_button')}
                    >
                      <PencilSimpleLine size={15} />
                    </button>
                  }
                />
              ) : props.activity.activity_type === 'TYPE_PLAY' ? (
                <Modal
                  isDialogOpen={editPlayModalOpen}
                  onOpenChange={() => setEditPlayModalOpen(!editPlayModalOpen)}
                  size="lg"
                  icon={<Lightning size={16} />}
                  dialogTitle={t('play_activity.edit_title', 'Play activity')}
                  dialogDescription={t('play_activity.edit_description', 'The play learners run in this lesson. Passing it completes the activity.')}
                  preventClose={editHost.submitting}
                  footer={editHost.footer(() => setEditPlayModalOpen(false), t('common.cancel'))}
                  dialogContent={editHost.wrap(
                    <PlayActivityEditModal
                      activity={props.activity}
                      courseUuid={props.course_uuid}
                      orgSlug={props.orgslug}
                      onClose={() => setEditPlayModalOpen(false)}
                    />
                  )}
                  dialogTrigger={
                    <button
                      className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                      title={t('play_activity.edit_button', 'Edit play activity')}
                    >
                      <PencilSimpleLine size={15} />
                    </button>
                  }
                />
              ) : editHref ? (
                <ToolTip
                  content={props.activity.activity_type === 'TYPE_ASSIGNMENT'
                    ? t('dashboard.courses.structure.actions.edit_assignment')
                    : props.activity.activity_type === 'TYPE_LIVE_SESSION'
                    ? t('dashboard.courses.structure.actions.manage_live_session')
                    : t('dashboard.courses.structure.actions.edit_page')}
                  side="top"
                >
                  <Link
                    href={editHref}
                    onMouseEnter={() => props.activity.activity_type === 'TYPE_DYNAMIC' && prefetchActivityEditor(router, editHref)}
                    onFocus={() => props.activity.activity_type === 'TYPE_DYNAMIC' && prefetchActivityEditor(router, editHref)}
                    target="_blank"
                    className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                  >
                    <PencilSimpleLine size={15} />
                  </Link>
                </ToolTip>
              ) : (
                <div className="h-9 w-9 sm:h-8 sm:w-8" />
              )}
              <ToolTip content={t('dashboard.courses.structure.actions.preview_activity')} side="top">
                <Link
                  href={previewHref}
                  className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                >
                  <Eye size={15} />
                </Link>
              </ToolTip>
              <LockPopover
                lockType={(props.activity.lock_type as LockType) || 'public'}
                onChangeLockType={changeLockType}
                fetchAssignedUserGroups={fetchActivityUserGroups}
                addUserGroup={addActivityUserGroup}
                removeUserGroup={removeActivityUserGroup}
                resourceNoun="activity"
                paid={{ courseUuid: props.course_uuid, resourceUuid: props.activity.activity_uuid, resourceName: props.activity.name }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
                    <DotsThreeVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                    <PencilSimple size={14} />
                    <span>{t('dashboard.courses.structure.actions.rename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={changePublicStatus} disabled={isPublishing}>
                    {props.activity.published ? <EyeSlash size={14} /> : <Globe size={14} />}
                    <span>
                      {props.activity.published
                        ? t('dashboard.courses.structure.actions.unpublish')
                        : t('dashboard.courses.structure.actions.publish')}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault()
                      setDeleteModalOpen(true)
                    }}
                    className="text-rose-600 focus:text-rose-600 focus:bg-rose-50"
                  >
                    <Trash size={14} />
                    <span>{t('dashboard.courses.structure.bulk_actions.delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>
          )}

          {/* Controlled: the dropdown item unmounts with the menu. */}
          <ConfirmDialog
            open={deleteModalOpen}
            onOpenChange={setDeleteModalOpen}
            title={t('dashboard.courses.structure.modals.delete_activity.title', { name: activityName })}
            message={t('dashboard.courses.structure.modals.delete_activity.message')}
            confirmLabel={t('dashboard.courses.structure.modals.delete_activity.button')}
            onConfirm={deleteActivityUI}
          />
        </div>
      )}
    </Draggable>
  )
}

const ACTIVITIES = {
  'TYPE_VIDEO': {
    displayNameKey: 'video',
    Icon: VideoCamera
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
    Icon: Browsers
  },
  'TYPE_SCORM': {
    displayNameKey: 'scorm',
    Icon: Package
  },
  'TYPE_LIVE_SESSION': {
    displayNameKey: 'livesession',
    Icon: Radio
  },
  'TYPE_PLAY': {
    displayNameKey: 'play',
    Icon: Lightning,
    fallback: 'Play'
  },
  'TYPE_CUSTOM': {
    displayNameKey: 'custom',
    Icon: PuzzlePiece
  }
}

const UNKNOWN_ACTIVITY = { displayNameKey: 'dynamic', Icon: Browsers }

const ActivityTypeIndicator = ({activityType, activitySubType, isMobile} : { activityType: keyof typeof ACTIVITIES, activitySubType?: string, isMobile: boolean}) => {
  const { t } = useTranslation()
  const isMarkdown = activitySubType === 'SUBTYPE_DYNAMIC_MARKDOWN'
  const isEmbed = activitySubType === 'SUBTYPE_DYNAMIC_EMBED'
  const isResource = activitySubType === 'SUBTYPE_DYNAMIC_RESOURCE'
  const {displayNameKey, Icon, fallback} = (isMarkdown
    ? { displayNameKey: 'markdown', Icon: MarkdownLogo }
    : isEmbed
    ? { displayNameKey: 'embed', Icon: GlobePhosphor }
    : isResource
    ? { displayNameKey: 'resource', Icon: Cube }
    : ACTIVITIES[activityType] ?? UNKNOWN_ACTIVITY) as { displayNameKey: string; Icon: React.ElementType; fallback?: string }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <Icon className="size-4 text-neutral-400" />
      {!isMobile && (
        <span className="text-xs text-neutral-400 font-medium">
          {fallback ? t(`dashboard.courses.structure.activity.types.${displayNameKey}`, fallback) : t(`dashboard.courses.structure.activity.types.${displayNameKey}`)}
        </span>
      )}
    </div>
  )
}

export default ActivityElement
