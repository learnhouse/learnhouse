'use client'
import { updateCourseOrderStructure } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  useCourse,
  useCourseDispatch,
  useDebounceManager,
} from '@components/Contexts/CourseContext'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { Check, FloppyDisk, WarningCircle } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { updateCourse } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useEditorDrafts, type SectionFailure } from '@components/Dashboard/Pages/Course/courseEditorSave'

// The one Save button of the course editor. It persists, in order:
// 1. the chapter/activity order and the course fields held in the course
//    context (general, SEO, access, contributors setting);
// 2. every section draft registered with the editor save store (schedule,
//    certificate, contributor roles, renamed chapters and activities).
// Failures are reported per section; whatever saved stays saved.
function SaveState(props: { orgslug: string }) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const queryClient = useQueryClient()
  const course = useCourse() as any
  const session = useLHSession() as any
  const router = useRouter()
  const dispatchCourse = useCourseDispatch() as any
  const debounceManager = useDebounceManager()
  const { hasDrafts, draftCount, dirtyLabels, saveDrafts } = useEditorDrafts()
  const saveInProgressRef = useRef(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<SectionFailure[]>([])

  const saved = course?.isSaved ?? true
  const isSaving = course?.isSaving ?? false
  const courseStructure = course?.courseStructure
  const metaDirty = !saved
  const dirty = metaDirty || hasDrafts
  const courseLabel = t('dashboard.courses.editor.save.course_settings')

  // Ref so saveCourseState always reads the latest unsynced changes without stale closure
  const unsyncedChangesRef = useRef<Partial<any>>({})
  useEffect(() => {
    unsyncedChangesRef.current = course?.unsyncedChanges ?? {}
  }, [course?.unsyncedChanges])

  const saveCourseState = useCallback(async () => {
    if (!dirty || isSaving || saveInProgressRef.current || !courseStructure?.course_uuid) {
      return
    }
    saveInProgressRef.current = true

    // Cancel pending debounces; their values are merged from unsyncedChanges below.
    debounceManager.cancelAll()
    dispatchCourse({ type: 'setSaving', payload: true })
    dispatchCourse({ type: 'setSaveError', payload: null })

    const total = (metaDirty ? 1 : 0) + draftCount
    let done = 0
    setProgress({ done, total })
    const failed: SectionFailure[] = []
    let anySaved = false

    try {
      if (metaDirty) {
        try {
          if (course.courseOrder && Object.keys(course.courseOrder).length > 0) {
            await updateCourseOrderStructure(
              courseStructure.course_uuid,
              course.courseOrder,
              session.data?.tokens?.access_token
            )
          }
          // Merge unsynced changes (made before the debounce fired) so saving
          // right after typing keeps the latest values.
          const dataToSave = { ...courseStructure, ...unsyncedChangesRef.current }
          delete dataToSave._certificationData
          const res = await updateCourse(courseStructure.course_uuid, dataToSave, session.data?.tokens?.access_token)
          if (res && res.success === false) {
            throw new Error(typeof res.data?.detail === 'string' ? res.data.detail : t('dashboard.courses.save.error'))
          }
          dispatchCourse({ type: 'setIsSaved' })
          dispatchCourse({ type: 'commitChanges' })
          anySaved = true
        } catch (error: any) {
          failed.push({ id: 'course', label: courseLabel, message: error?.message || t('dashboard.courses.save.error') })
        }
        done += 1
        setProgress({ done, total })
      }

      if (hasDrafts) {
        const before = done
        const draftFailures = await saveDrafts((d) => setProgress({ done: before + d, total }))
        failed.push(...draftFailures)
        if (draftFailures.length < draftCount) anySaved = true
      }

      if (anySaved) {
        const cleanUuid = courseStructure.course_uuid.replace(/^course_/, '')
        queryClient.invalidateQueries({ queryKey: ['course', cleanUuid, 'meta'] })
        queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(props.orgslug) })
        await revalidateTags(['courses'], props.orgslug)
        router.refresh()
      }

      track(AnalyticsEvent.CourseChangesSaved, {
        order_changed: metaDirty,
        metadata_changed: metaDirty,
        save_succeeded: failed.length === 0,
      })

      setFailures(failed)
      if (failed.length === 0) {
        toast.success(t('dashboard.courses.save.success'))
      } else {
        dispatchCourse({ type: 'setSaveError', payload: failed.map((f) => f.label).join(', ') })
        toast.error(
          <div className="text-sm">
            <p className="font-semibold">
              {anySaved
                ? t('dashboard.courses.editor.save.partial_title')
                : t('dashboard.courses.save.error')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {failed.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.label}</span>: {f.message}
                </li>
              ))}
            </ul>
          </div>,
          { duration: 6000 }
        )
      }
    } finally {
      dispatchCourse({ type: 'setSaving', payload: false })
      setProgress(null)
      saveInProgressRef.current = false
    }
  }, [
    dirty,
    metaDirty,
    hasDrafts,
    draftCount,
    isSaving,
    courseStructure,
    course.courseOrder,
    courseLabel,
    queryClient,
    session.data?.tokens?.access_token,
    debounceManager,
    dispatchCourse,
    saveDrafts,
    router,
    props.orgslug,
    track,
    t,
  ])

  // Calculate the course order from structure
  const handleCourseOrder = useCallback((structure: any) => {
    if (!Array.isArray(structure?.chapters)) return

    const chapter_order_by_ids = structure.chapters.map((chapter: any) => ({
      chapter_id: chapter.id,
      activities_order_by_ids: (chapter.activities ?? []).map((activity: any) => ({
        activity_id: activity.id,
      })),
    }))

    dispatchCourse({
      type: 'setCourseOrder',
      payload: { chapter_order_by_ids },
    })
  }, [dispatchCourse])

  // Initialize order on mount and when structure changes
  useEffect(() => {
    if (courseStructure?.chapters && saved) {
      handleCourseOrder(courseStructure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseStructure?.chapters?.length, saved, handleCourseOrder])

  // Update order when structure changes and not saved
  useEffect(() => {
    if (courseStructure?.chapters && !saved) {
      handleCourseOrder(courseStructure)
    }
  }, [courseStructure, saved, handleCourseOrder])

  // Cmd/Ctrl+S saves from anywhere in the editor.
  const saveRef = useRef(saveCourseState)
  useEffect(() => {
    saveRef.current = saveCourseState
  }, [saveCourseState])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const saveError = course?.saveError
  const pendingLabels = [...(metaDirty ? [courseLabel] : []), ...dirtyLabels]

  if (isSaving) {
    return (
      <Button variant="primary" loading>
        {progress && progress.total > 1
          ? t('dashboard.courses.editor.save.saving_progress', { done: progress.done, total: progress.total })
          : t('dashboard.courses.save.saving')}
      </Button>
    )
  }

  if (!dirty && !saveError) {
    return (
      <span className="inline-flex items-center gap-1.5 h-8 px-2 text-[13px] font-medium text-neutral-400 whitespace-nowrap select-none">
        <Check size={15} />
        {t('dashboard.courses.save.saved')}
      </span>
    )
  }

  if (saveError && failures.length > 0) {
    return (
      <Button
        variant="danger"
       
        icon={<WarningCircle size={15} />}
        onClick={saveCourseState}
        title={failures.map((f) => `${f.label}: ${f.message}`).join('\n')}
       
      >
        {t('dashboard.courses.save.retry_button')}
      </Button>
    )
  }

  return (
    <Button
      variant="primary"
     
      icon={<FloppyDisk size={15} />}
      onClick={saveCourseState}
      title={`${t('dashboard.courses.save.unsaved')}: ${pendingLabels.join(', ')}`}
     
    >
      {t('dashboard.courses.save.save')}
      {pendingLabels.length > 1 ? (
        <span className="ms-0.5 min-w-5 h-5 px-1.5 rounded-full bg-amber-400 text-[11px] font-bold text-amber-950 inline-flex items-center justify-center tabular-nums">
          {pendingLabels.length}
        </span>
      ) : (
        <span className="ms-0.5 w-2 h-2 rounded-full bg-amber-400" aria-label={t('dashboard.courses.save.unsaved')} />
      )}
    </Button>
  )
}

export default SaveState
