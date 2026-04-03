import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  Check,
  Globe,
  Hexagon,
  Loader2,
  Lock,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react'
import React from 'react'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import ActivityElement from './ActivityElement'
import NewActivityButton from '../Buttons/NewActivityButton'
import { deleteChapter, updateChapter } from '@services/courses/chapters'
import { deleteActivity, updateActivity } from '@services/courses/activities'
import { deleteAssignmentUsingActivityUUID } from '@services/courses/assignments'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { getAPIUrl } from '@services/config/config'
import { mutate } from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse, useCourseDispatch, getCourseMetaCacheKey } from '@components/Contexts/CourseContext'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type ChapterElementProps = {
  chapter: any
  chapterIndex: number
  orgslug: string
  course_uuid: string
}

interface ModifiedChapterInterface {
  chapterId: string
  chapterName: string
}

function ChapterElement(props: ChapterElementProps) {
  const { t } = useTranslation()
  const activities = props.chapter.activities || []
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [modifiedChapter, setModifiedChapter] = React.useState<
    ModifiedChapterInterface | undefined
  >(undefined)
  const [selectedChapter, setSelectedChapter] = React.useState<
    string | undefined
  >(undefined)
  const course = useCourse() as any;
  const dispatchCourse = useCourseDispatch() as any;
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

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

  const updateLocalActivities = (updater: (activity: any) => any | null) => {
    const updatedStructure = {
      ...course.courseStructure,
      chapters: course.courseStructure.chapters.map((ch: any) => ({
        ...ch,
        activities: ch.activities.map(updater).filter(Boolean),
      })),
    }
    dispatchCourse({ type: 'setCourseStructure', payload: updatedStructure })
    dispatchCourse({ type: 'setIsSaved' })
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
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(t('dashboard.courses.structure.bulk_actions.delete_error'))
    } finally {
      setIsBulkLoading(false)
    }
  }

  const deleteChapterUI = async () => {
    await deleteChapter(props.chapter.id, access_token)
    await mutate(getCourseMetaCacheKey(props.course_uuid, withUnpublishedActivities), undefined, { revalidate: true })
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  async function updateChapterName(chapterId: string) {
    if (modifiedChapter?.chapterId === chapterId) {
      let modifiedChapterCopy = {
        name: modifiedChapter.chapterName,
      }
      await updateChapter(chapterId, modifiedChapterCopy, access_token)
      await mutate(getCourseMetaCacheKey(props.course_uuid, withUnpublishedActivities), undefined, { revalidate: true })
      await revalidateTags(['courses'], props.orgslug)
      router.refresh()
    }
    setSelectedChapter(undefined)
  }

  return (
    <Draggable
      key={props.chapter.chapter_uuid}
      draggableId={props.chapter.chapter_uuid}
      index={props.chapterIndex}
    >
      {(provided, snapshot) => (
        <div
          className={`mx-2 sm:mx-4 md:mx-6 lg:mx-10 bg-white rounded-xl nice-shadow px-3 sm:px-4 md:px-6 pt-4 sm:pt-6 ${
            snapshot.isDragging ? 'shadow-xl ring-2 ring-blue-500/20 rotate-1' : ''
          }`}
          key={props.chapter.chapter_uuid}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          ref={provided.innerRef}
        >
          <div className="flex flex-wrap items-center justify-between pb-3">
            <div className="flex grow items-center space-x-2 mb-2 sm:mb-0">
              <div className="bg-neutral-100 rounded-md p-2">
                <Hexagon
                  strokeWidth={3}
                  size={16}
                  className="text-neutral-600"
                />
              </div>
              <div className="flex items-center space-x-2">
                {selectedChapter === props.chapter.id ? (
                  <div className="chapter-modification-zone bg-neutral-100 py-1 px-2 sm:px-4 rounded-lg flex items-center space-x-2">
                    <input
                      type="text"
                      className="bg-transparent outline-hidden text-sm text-neutral-700 w-full max-w-[150px] sm:max-w-none"
                      placeholder={t('dashboard.courses.structure.chapter_element.chapter_name_placeholder')}
                      value={
                        modifiedChapter
                          ? modifiedChapter?.chapterName
                          : props.chapter.name
                      }
                      onChange={(e) =>
                        setModifiedChapter({
                          chapterId: props.chapter.id,
                          chapterName: e.target.value,
                        })
                      }
                    />
                    <button
                      onClick={() => updateChapterName(props.chapter.id)}
                      className="bg-transparent text-neutral-700 hover:cursor-pointer hover:text-neutral-900"
                    >
                      <Save size={15} />
                    </button>
                  </div>
                ) : (
                  <p className="text-neutral-700 first-letter:uppercase text-sm sm:text-base">
                    {props.chapter.name}
                  </p>
                )}
                <Pencil
                  size={15}
                  onClick={() => setSelectedChapter(props.chapter.id)}
                  className="text-neutral-600 hover:cursor-pointer"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <MoreVertical size={15} className="text-gray-300" />
              <ConfirmationModal
                confirmationButtonText={t('dashboard.courses.structure.modals.delete_chapter.button')}
                confirmationMessage={t('dashboard.courses.structure.modals.delete_chapter.message')}
                dialogTitle={t('dashboard.courses.structure.modals.delete_chapter.title', { name: props.chapter.name })}
                dialogTrigger={
                  <button
                    className="hover:cursor-pointer p-1 px-2 sm:px-3 bg-red-600 rounded-md shadow-sm flex items-center text-rose-100 text-sm"
                    rel="noopener noreferrer"
                  >
                    <Trash2 size={15} className="text-rose-200" />
                  </button>
                }
                functionToExecute={() => deleteChapterUI()}
                status="warning"
              />
            </div>
          </div>

          {/* Bulk action bar */}
          {hasSelection && (
            <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-blue-50 rounded-lg border border-blue-200 animate-in fade-in duration-150">
              <button
                onClick={toggleSelectAll}
                className={`h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  allSelected
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-blue-400 bg-white hover:border-blue-500'
                }`}
              >
                {allSelected && <Check size={12} strokeWidth={3} />}
              </button>
              <span className="text-xs font-medium text-blue-700">
                {t('dashboard.courses.structure.bulk_actions.selected', { count: selectedActivities.size })}
              </span>
              <div className="flex-1" />
              {isBulkLoading ? (
                <Loader2 size={16} className="animate-spin text-blue-500" />
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => bulkUpdatePublished(true)}
                    className="h-7 px-2.5 rounded-md text-xs font-bold flex items-center gap-1 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors"
                  >
                    <Globe size={12} />
                    <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.publish')}</span>
                  </button>
                  <button
                    onClick={() => bulkUpdatePublished(false)}
                    className="h-7 px-2.5 rounded-md text-xs font-bold flex items-center gap-1 bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
                  >
                    <Lock size={12} />
                    <span className="hidden sm:inline">{t('dashboard.courses.structure.actions.unpublish')}</span>
                  </button>
                  <ConfirmationModal
                    confirmationMessage={t('dashboard.courses.structure.bulk_actions.delete_confirm', { count: selectedActivities.size })}
                    confirmationButtonText={t('dashboard.courses.structure.bulk_actions.delete_button')}
                    dialogTitle={t('dashboard.courses.structure.bulk_actions.delete_title')}
                    dialogTrigger={
                      <button className="h-7 px-2.5 rounded-md text-xs font-bold flex items-center gap-1 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
                        <Trash2 size={12} />
                        <span className="hidden sm:inline">{t('dashboard.courses.structure.bulk_actions.delete')}</span>
                      </button>
                    }
                    functionToExecute={bulkDelete}
                    status="warning"
                  />
                  <div className="w-px h-5 bg-blue-200 mx-0.5" />
                  <button
                    onClick={clearSelection}
                    className="h-7 px-2 rounded-md text-xs text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    {t('dashboard.courses.structure.bulk_actions.clear')}
                  </button>
                </div>
              )}
            </div>
          )}

          <Droppable
            key={props.chapter.chapter_uuid}
            droppableId={props.chapter.chapter_uuid}
            type="activity"
          >
            {(provided, snapshot) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className={`min-h-[60px] rounded-lg transition-colors duration-75 ${
                  snapshot.isDraggingOver ? 'bg-blue-50/50' : ''
                }`}
              >
                {activities.map((activity: any, index: any) => (
                  <ActivityElement
                    key={activity.activity_uuid}
                    orgslug={props.orgslug}
                    course_uuid={props.course_uuid}
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
          <NewActivityButton
            orgslug={props.orgslug}
            chapterId={props.chapter.id}
          />
          <div className="h-6">
            <div className="flex items-center">
              <MoreHorizontal size={19} className="text-gray-300 mx-auto" />
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export default ChapterElement
