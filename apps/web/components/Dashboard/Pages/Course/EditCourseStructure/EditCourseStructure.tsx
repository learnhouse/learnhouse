'use client'
import { revalidateTags } from '@services/utils/ts/requests'
import React, { useEffect, useState } from 'react'
import { DragDropContext, Droppable } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import ChapterElement from './DraggableElements/ChapterElement'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { createChapter } from '@services/courses/chapters'
import { useRouter } from 'next/navigation'
import {
  useCourse,
  useCourseDispatch,
} from '@components/Contexts/CourseContext'
import { Hexagon, Plus } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import NewChapterModal from '@components/Objects/Modals/Chapters/NewChapter'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import toast from 'react-hot-toast'
import { Button, EmptyState } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useModalFormHost } from '@components/Objects/Modals/Activities/activityFormKit'
import { EditorPage } from '../courseEditorUi'

type EditCourseStructureProps = {
  orgslug: string
  course_uuid?: string
}

export type OrderPayload =
  | {
      chapter_order_by_ids: [
        {
          chapter_id: string
          activities_order_by_ids: [
            {
              activity_id: string
            },
          ]
        },
      ]
    }
  | undefined

const EditCourseStructure = (props: EditCourseStructureProps) => {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const router = useRouter()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient()
  const cleanCourseUuid = (id: string) => id?.replace(/^course_/, '') ?? id
  // Check window availability
  const [winReady, setwinReady] = useState(false)

  const dispatchCourse = useCourseDispatch() as any

  // After a course is created we redirect to `.../content?new_activity=1` so the
  // teacher lands directly on the first activity creation. Read that flag on mount,
  // then strip it from the URL so a refresh doesn't reopen the modal.
  const [autoOpenFirstActivity, setAutoOpenFirstActivity] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('new_activity') === '1') {
      setAutoOpenFirstActivity(true)
      params.delete('new_activity')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  const [_order, _setOrder] = useState<OrderPayload>()
  const course = useCourse() as any
  const course_structure = course ? course.courseStructure : {}
  const course_uuid = course ? course.courseStructure.course_uuid : ''
  const _withUnpublishedActivities = course ? course.withUnpublishedActivities : false
  // New Chapter creation
  const [newChapterModal, setNewChapterModal] = useState(false)

  const closeNewChapterModal = async () => {
    setNewChapterModal(false)
  }

  const chapterHost = useModalFormHost()

  // Submit new chapter
  const submitChapter = async (chapter: any) => {
    try {
      await createChapter(chapter, access_token)
    } catch (error: any) {
      toast.error(error?.message || t('dashboard.courses.editor.chapter_form.create_error'))
      return
    }
    track(AnalyticsEvent.ChapterCreated, {
      chapter_count_after: (course_structure?.chapters?.length ?? 0) + 1,
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)) })
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
    setNewChapterModal(false)
  }

  const updateStructure = (result: any) => {
    const { destination, source, type } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return

    const newCourseStructure = { ...course_structure }
    
    if (type === 'chapter') {
      const newChapterOrder = Array.from(newCourseStructure.chapters)
      const [movedChapter] = newChapterOrder.splice(source.index, 1)
      newChapterOrder.splice(destination.index, 0, movedChapter)
      newCourseStructure.chapters = newChapterOrder
    }

    if (type === 'activity') {
      const newChapterOrder = Array.from(newCourseStructure.chapters)
      const sourceChapter = newChapterOrder.find(
        (chapter: any) => chapter.chapter_uuid === source.droppableId
      ) as any
      const destinationChapter = newChapterOrder.find(
        (chapter: any) => chapter.chapter_uuid === destination.droppableId
      ) ?? sourceChapter

      const [movedActivity] = sourceChapter.activities.splice(source.index, 1)
      destinationChapter.activities.splice(destination.index, 0, movedActivity)
      newCourseStructure.chapters = newChapterOrder
    }

    dispatchCourse({
      type: 'setCourseStructure',
      payload: newCourseStructure,
    })
    dispatchCourse({ type: 'setIsNotSaved' })

    track(AnalyticsEvent.CourseStructureReordered, { reorder_type: type })
  }

  useEffect(() => {
    setwinReady(true)
  }, [props.course_uuid, course_structure, course])

  if (!course) return <PageLoading></PageLoading>

  const chapters: any[] = course_structure.chapters || []
  const activityCount = chapters.reduce((sum, ch) => sum + (ch.activities?.length || 0), 0)

  return (
    <EditorPage>
      {winReady ? (
        <DragDropContext onDragEnd={updateStructure}>
          {chapters.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neutral-500 tabular-nums">
                {t('dashboard.courses.editor.content.chapter_count', { count: chapters.length })}
                <span className="mx-1.5 text-neutral-300">·</span>
                {t('dashboard.courses.editor.content.activity_count', { count: activityCount })}
              </p>
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewChapterModal(true)}>
                {t('dashboard.courses.structure.actions.add_chapter')}
              </Button>
            </div>
          )}

          <Droppable type="chapter" droppableId="chapters" direction="vertical">
            {(provided, snapshot) => (
              <div
                className={`space-y-4 rounded-2xl transition-colors ${snapshot.isDraggingOver ? 'bg-neutral-100/60' : ''}`}
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {chapters.map((chapter: any, index: any) => {
                    return (
                      <ChapterElement
                        key={chapter.chapter_uuid}
                        chapterIndex={index}
                        orgslug={props.orgslug}
                        course_uuid={course_uuid}
                        chapter={chapter}
                        autoOpenNewActivity={index === 0 && autoOpenFirstActivity}
                      />
                    )
                  })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {chapters.length === 0 ? (
            <div className="bg-white rounded-2xl nice-shadow">
              <EmptyState
                icon={<Hexagon size={22} />}
                title={t('dashboard.courses.editor.content.empty_title')}
                description={t('dashboard.courses.editor.content.empty_description')}
                action={
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewChapterModal(true)}>
                    {t('dashboard.courses.structure.actions.add_chapter')}
                  </Button>
                }
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNewChapterModal(true)}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-200 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 hover:border-neutral-300 hover:bg-white transition-colors"
            >
              <Hexagon size={16} />
              {t('dashboard.courses.structure.actions.add_chapter')}
            </button>
          )}

          {/* New Chapter Modal */}
          <Modal
            isDialogOpen={newChapterModal}
            onOpenChange={setNewChapterModal}
            size="sm"
            preventClose={chapterHost.submitting}
            icon={<Hexagon size={16} />}
            dialogTitle={t('dashboard.courses.structure.modals.new_chapter.title')}
            dialogDescription={t('dashboard.courses.structure.modals.new_chapter.description')}
            footer={chapterHost.footer(closeNewChapterModal, t('common.cancel'))}
            dialogContent={chapterHost.wrap(
              <NewChapterModal
                course={course ? course.courseStructure : null}
                closeModal={closeNewChapterModal}
                submitChapter={submitChapter}
              />
            )}
          />
        </DragDropContext>
      ) : (
        <></>
      )}
    </EditorPage>
  )
}

export default EditCourseStructure
