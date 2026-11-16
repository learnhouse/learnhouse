import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { CalendarCheck, Globe, CircleNotch, Lock, PencilSimple, Trash } from '@phosphor-icons/react'
import { AtlasItemMenu } from '@ee/components/Atlas/CourseAtlas'
import React from 'react'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import ActivityElement from './ActivityElement'
import NewActivityButton from '../Buttons/NewActivityButton'
import {
  addUserGroupToChapter,
  deleteChapter,
  getChapterUserGroups,
  removeUserGroupFromChapter,
  updateChapter,
} from '@services/courses/chapters'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import LockPopover, { LockType } from './LockPopover'
import { deleteAssignmentUsingActivityUUID } from '@services/courses/assignments'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { normalizeRule } from '@/lib/drip'
import { SelectBox } from '../../courseEditorUi'
import { ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useRenameDraft } from '../useRenameDraft'
import { InlineNameEditor } from './InlineNameEditor'
import { ChapterEmojiButton } from './ChapterEmojiButton'
import { getChapterEmoji } from '@components/Objects/Courses/ChapterEmoji/ChapterEmoji'

type ChapterElementProps = {
  chapter: any
  chapterIndex: number
  orgslug: string
  course_uuid: string
  // Auto-open the add-activity modal for this chapter (used on the first chapter
  // right after a course is created).
  autoOpenNewActivity?: boolean
}

function ChapterElement(props: ChapterElementProps) {
  const { t, i18n } = useTranslation()
  const activities = props.chapter.activities || []
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false)
  const renames = useRenameDraft()
  const chapterName = renames.chapterName(props.chapter.id, props.chapter.name)
  const savedEmoji = getChapterEmoji(props.chapter)
  const chapterEmoji = renames.chapterEmoji(props.chapter.id, savedEmoji)
  const course = useCourse() as any;
  const dispatchCourse = useCourseDispatch() as any;
  const _withUnpublishedActivities = course ? course.withUnpublishedActivities : false
  const queryClient = useQueryClient()
  const cleanCourseUuid = (id: string) => id?.replace(/^course_/, '') ?? id

  const router = useRouter()

  // Selection state
  const [selectedActivities, setSelectedActivities] = React.useState<Set<string>>(new Set())
  const [isBulkLoading, setIsBulkLoading] = React.useState(false)
  const hasSelection = selectedActivities.size > 0
  const allSelected = activities.length > 0 && selectedActivities.size === activities.length

  const toggleActivitySelection = (activityUuid: string) => {
    setSelectedActivities((prev) => {
      const next = new Set(prev)
      if (next.has(activityUuid)) next.delete(activityUuid)
      else next.add(activityUuid)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedActivities(new Set())
    } else {
      setSelectedActivities(new Set(activities.map((a: any) => a.activity_uuid)))
    }
  }

  const clearSelection = () => setSelectedActivities(new Set())

  const updateLocalActivities = (updater: (_activity: any) => any | null) => {
    const updatedStructure = {
      ...course.courseStructure,
      chapters: course.courseStructure.chapters.map((ch: any) => ({
        ...ch,
        activities: ch.activities.map(updater).filter(Boolean),
      })),
    }
    // Server-confirmed: patch without touching other unsaved edits.
    dispatchCourse({ type: 'patchStructure', payload: { chapters: updatedStructure.chapters } })
  }

  const bulkUpdatePublished = async (published: boolean) => {
    setIsBulkLoading(true)
    const count = selectedActivities.size
    try {
      const results = await Promise.all(
        Array.from(selectedActivities).map((uuid) =>
          updateActivity({ published }, uuid, access_token)
        )
      )
      const failed = results.filter((r) => !r.success).length
      if (failed > 0) {
        toast.error(t('dashboard.courses.structure.bulk_actions.partial_error', { failed, total: count }))
      } else {
        updateLocalActivities((a: any) =>
          selectedActivities.has(a.activity_uuid) ? { ...a, published } : a
        )
        toast.success(
          published
            ? t('dashboard.courses.structure.bulk_actions.publish_success', { count })
            : t('dashboard.courses.structure.bulk_actions.unpublish_success', { count })
        )
      }
      clearSelection()
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(
        published
          ? t('dashboard.courses.structure.bulk_actions.publish_error')
          : t('dashboard.courses.structure.bulk_actions.unpublish_error')
      )
    } finally {
      setIsBulkLoading(false)
    }
  }

  const bulkDelete = async () => {
    setIsBulkLoading(true)
    const count = selectedActivities.size
    try {
      const selectedList = activities.filter((a: any) => selectedActivities.has(a.activity_uuid))
      for (const activity of selectedList) {
        if (activity.activity_type === 'TYPE_ASSIGNMENT') {
          await deleteAssignmentUsingActivityUUID(activity.activity_uuid, access_token)
        }
        await deleteActivity(activity.activity_uuid, access_token)
      }
      // Remove deleted activities from local state
      updateLocalActivities((a: any) =>
        selectedActivities.has(a.activity_uuid) ? null : a
      )
      clearSelection()
      toast.success(t('dashboard.courses.structure.bulk_actions.delete_success', { count }))
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(t('dashboard.courses.structure.bulk_actions.delete_error'))
    } finally {
      setIsBulkLoading(false)
    }
  }

  const deleteChapterUI = async () => {
    await deleteChapter(props.chapter.id, access_token)
    await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Short label for this chapter's drip rule when the course drips content.
  const dripRule = normalizeRule(props.chapter.drip_rule)
  const dripSummary = course?.courseStructure?.drip_settings?.enabled
    ? dripRule.mode === 'date' && dripRule.release_at
      ? new Date(dripRule.release_at).toLocaleDateString(i18n.language || 'en', { month: 'short', day: 'numeric' })
      : dripRule.mode === 'delay' && dripRule.delay_days > 0
        ? t('dashboard.courses.structure.chapter_element.drip_day', { defaultValue: 'Day {{count}}', count: dripRule.delay_days })
        : t('dashboard.courses.structure.chapter_element.drip_now', 'Day 0')
    : null

  async function changeChapterLockType(next: LockType) {
    try {
      await updateChapter(props.chapter.id, { lock_type: next }, access_token)
      const updatedStructure = {
        ...course.courseStructure,
        chapters: course.courseStructure.chapters.map((ch: any) =>
          ch.chapter_uuid === props.chapter.chapter_uuid ? { ...ch, lock_type: next } : ch
        ),
      }
      dispatchCourse({ type: 'patchStructure', payload: { chapters: updatedStructure.chapters } })
      toast.success(t('dashboard.courses.structure.activity.toasts.update_success'))
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(props.course_uuid)) })
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(t('dashboard.courses.structure.activity.toasts.update_error'))
    }
  }

  async function fetchChapterUserGroups() {
    const groups = await getChapterUserGroups(props.chapter.chapter_uuid, access_token)
    return Array.isArray(groups) ? groups : []
  }

  async function addChapterUserGroup(usergroup_uuid: string) {
    await addUserGroupToChapter(props.chapter.chapter_uuid, usergroup_uuid, access_token)
  }

  async function removeChapterUserGroup(usergroup_uuid: string) {
    await removeUserGroupFromChapter(props.chapter.chapter_uuid, usergroup_uuid, access_token)
  }

  const bulkBtn =
    'h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap'

  return (
    <Draggable
      key={props.chapter.chapter_uuid}
      draggableId={props.chapter.chapter_uuid}
      index={props.chapterIndex}
    >
      {(provided, snapshot) => (
        <div
          className={`bg-white rounded-2xl nice-shadow ${
            snapshot.isDragging ? 'shadow-xl ring-2 ring-neutral-900/10' : ''
          }`}
          key={props.chapter.chapter_uuid}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <div className="group flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
            <div className="flex grow items-center gap-3 min-w-0">
              {/* Staged like a rename: the header Save sends it. */}
              <ChapterEmojiButton
                emoji={chapterEmoji}
                onChange={(emoji) => renames.setChapterEmoji(props.chapter.id, emoji, savedEmoji)}
              />
              <div className="min-w-0 grow">
                {isRenaming ? (
                  <InlineNameEditor
                    initial={chapterName}
                    placeholder={t('dashboard.courses.structure.chapter_element.chapter_name_placeholder')}
                    onCommit={(name) => {
                      renames.renameChapter(props.chapter.id, name, props.chapter.name)
                      setIsRenaming(false)
                    }}
                    onCancel={() => setIsRenaming(false)}
                    className="max-w-md text-base font-semibold"
                  />
                ) : (
                  <div className="flex items-center gap-1 min-w-0">
                    <h3
                      className="text-base font-semibold text-neutral-900 truncate cursor-text"
                      onDoubleClick={() => setIsRenaming(true)}
                    >
                      {chapterName}
                    </h3>
                    {renames.isChapterRenamed(props.chapter.id) && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                        title={t('dashboard.courses.save.unsaved')}
                        aria-label={t('dashboard.courses.save.unsaved')}
                      />
                    )}
                    <ToolTip content={t('dashboard.courses.structure.actions.rename_chapter', { defaultValue: 'Rename chapter' })} side="top">
                      <button
                        type="button"
                        onClick={() => setIsRenaming(true)}
                        aria-label={t('dashboard.courses.structure.actions.rename_chapter', { defaultValue: 'Rename chapter' })}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 shrink-0"
                      >
                        <PencilSimple size={14} />
                      </button>
                    </ToolTip>
                  </div>
                )}
                <p className="text-xs text-neutral-400 tabular-nums">
                  {t('dashboard.courses.editor.content.activity_count', { count: activities.length })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <AtlasItemMenu chapter={{ uuid: props.chapter.chapter_uuid, name: chapterName, id: props.chapter.id }} />
              {dripSummary && (
                <ToolTip content={t('dashboard.courses.structure.chapter_element.drip_tooltip', 'Release schedule: edit it in the Schedule tab')} side="top">
                  <Link
                    href={getUriWithOrg(props.orgslug, '') + `/dash/courses/course/${cleanCourseUuid(props.course_uuid)}/schedule`}
                    data-testid="chapter-drip-chip"
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors"
                  >
                    <CalendarCheck size={12} />
                    {dripSummary}
                  </Link>
                </ToolTip>
              )}
              <LockPopover
                lockType={(props.chapter.lock_type as LockType) || 'public'}
                onChangeLockType={changeChapterLockType}
                fetchAssignedUserGroups={fetchChapterUserGroups}
                addUserGroup={addChapterUserGroup}
                removeUserGroup={removeChapterUserGroup}
                resourceNoun="chapter"
                paid={{ courseUuid: props.course_uuid, resourceUuid: props.chapter.chapter_uuid, resourceName: props.chapter.name }}
              />
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={t('dashboard.courses.structure.modals.delete_chapter.button')}
                title={t('dashboard.courses.structure.modals.delete_chapter.button')}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash size={15} />
              </button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={t('dashboard.courses.structure.modals.delete_chapter.title', { name: chapterName })}
                message={t('dashboard.courses.structure.modals.delete_chapter.message')}
                confirmLabel={t('dashboard.courses.structure.modals.delete_chapter.button')}
                onConfirm={deleteChapterUI}
              />
            </div>
          </div>

          {/* Bulk action bar */}
          {hasSelection && (
            <div className="mx-3 sm:mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-neutral-900 text-white ps-3 pe-1.5 py-1.5 animate-in fade-in duration-150">
              <SelectBox inverse checked={allSelected} onClick={toggleSelectAll} />
              <span className="text-xs font-semibold tabular-nums">
                {t('dashboard.courses.structure.bulk_actions.selected', { count: selectedActivities.size })}
              </span>
              <div className="flex-1" />
              {isBulkLoading ? (
                <CircleNotch size={16} className="animate-spin text-white/70 me-2" />
              ) : (
                <div className="flex items-center gap-0.5">
                  <ToolTip content={t('dashboard.courses.structure.bulk_actions.publish_tooltip', { defaultValue: 'Publish selected' })} side="top">
                    <button
                      type="button"
                      onClick={() => bulkUpdatePublished(true)}
                      className={`${bulkBtn} text-white/80 hover:text-white hover:bg-white/10`}
                    >
                      <Globe size={13} />
                      <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.publish')}</span>
                    </button>
                  </ToolTip>
                  <ToolTip content={t('dashboard.courses.structure.bulk_actions.unpublish_tooltip', { defaultValue: 'Unpublish selected' })} side="top">
                    <button
                      type="button"
                      onClick={() => bulkUpdatePublished(false)}
                      className={`${bulkBtn} text-white/80 hover:text-white hover:bg-white/10`}
                    >
                      <Lock size={13} />
                      <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.unpublish')}</span>
                    </button>
                  </ToolTip>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(true)}
                    className={`${bulkBtn} text-rose-300 hover:text-white hover:bg-rose-500/80`}
                  >
                    <Trash size={13} />
                    <span className="hidden sm:inline">{t('dashboard.courses.structure.bulk_actions.delete')}</span>
                  </button>
                  <span className="w-px h-5 bg-white/15 mx-1" />
                  <button
                    type="button"
                    onClick={clearSelection}
                    className={`${bulkBtn} text-white/60 hover:text-white hover:bg-white/10`}
                  >
                    {t('dashboard.courses.structure.bulk_actions.clear')}
                  </button>
                </div>
              )}
            </div>
          )}

          <ConfirmDialog
            open={confirmBulkDelete}
            onOpenChange={setConfirmBulkDelete}
            title={t('dashboard.courses.structure.bulk_actions.delete_title')}
            message={t('dashboard.courses.structure.bulk_actions.delete_confirm', { count: selectedActivities.size })}
            confirmLabel={t('dashboard.courses.structure.bulk_actions.delete_button')}
            onConfirm={bulkDelete}
          />

          <Droppable
            key={props.chapter.chapter_uuid}
            droppableId={props.chapter.chapter_uuid}
            type="activity"
          >
            {(provided, snapshot) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className={`mx-3 sm:mx-4 min-h-[48px] rounded-xl transition-colors duration-75 ${
                  snapshot.isDraggingOver ? 'bg-neutral-100/70' : ''
                }`}
              >
                {activities.map((activity: any, index: any) => (
                  <ActivityElement
                    key={activity.activity_uuid}
                    orgslug={props.orgslug}
                    course_uuid={props.course_uuid}
                    chapter_id={props.chapter.id}
                    chapter_name={chapterName}
                    activityIndex={index}
                    activity={activity}
                    isSelected={selectedActivities.has(activity.activity_uuid)}
                    onToggleSelect={() => toggleActivitySelection(activity.activity_uuid)}
                    selectionMode={hasSelection}
                  />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
          <div className="px-3 sm:px-4 pt-1 pb-4">
            <NewActivityButton
              orgslug={props.orgslug}
              chapterId={props.chapter.id}
              autoOpen={props.autoOpenNewActivity}
            />
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default ChapterElement
