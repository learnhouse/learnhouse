'use client'
import { getAPIUrl } from '@services/config/config'
import { updateCourseOrderStructure } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  useCourse,
  useCourseDispatch,
  useDebounceManager,
  getCourseMetaCacheKey,
} from '@components/Contexts/CourseContext'
import { Check, SaveAllIcon, Timer, Loader2, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useCallback, useRef } from 'react'
import { mutate } from 'swr'
import { updateCourse } from '@services/courses/courses'
import { updateCertification } from '@services/courses/certifications'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

interface SaveResult {
  success: boolean
  operation: string
  error?: Error
}

function SaveState(props: { orgslug: string }) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const session = useLHSession() as any
  const router = useRouter()
  const dispatchCourse = useCourseDispatch() as any
  const debounceManager = useDebounceManager()
  const saveInProgressRef = useRef(false)

  const saved = course?.isSaved ?? true
  const isSaving = course?.isSaving ?? false
  const courseStructure = course?.courseStructure
  const withUnpublishedActivities = course?.withUnpublishedActivities ?? false

  // Unified cache key
  const cacheKey = courseStructure?.course_uuid
    ? getCourseMetaCacheKey(courseStructure.course_uuid, withUnpublishedActivities)
    : null

  const saveCourseState = useCallback(async () => {
    if (saved || isSaving || saveInProgressRef.current || !courseStructure?.course_uuid) {
      return
    }

    // Prevent double-save
    saveInProgressRef.current = true

    // Cancel all pending debounces to ensure we save the current state
    debounceManager.cancelAll()

    // Mark as saving
    dispatchCourse({ type: 'setSaving', payload: true })
    dispatchCourse({ type: 'setSaveError', payload: null })

    // Store the state before saving for potential rollback
    const stateBeforeSave = { ...courseStructure }

    const results: SaveResult[] = []

    try {
      // 1. Save course order (if changed)
      if (course.courseOrder && Object.keys(course.courseOrder).length > 0) {
        try {
          await updateCourseOrderStructure(
            courseStructure.course_uuid,
            course.courseOrder,
            session.data?.tokens?.access_token
          )
          results.push({ success: true, operation: 'order' })
        } catch (error) {
          results.push({ success: false, operation: 'order', error: error as Error })
          throw error // Stop on order save failure
        }
      }

      // 2. Save course metadata
      try {
        // Clean up temporary fields before saving
        const dataToSave = { ...courseStructure }
        delete dataToSave._certificationData // Don't send certification temp data to course endpoint

        await updateCourse(
          courseStructure.course_uuid,
          dataToSave,
          session.data?.tokens?.access_token
        )
        results.push({ success: true, operation: 'metadata' })
      } catch (error) {
        results.push({ success: false, operation: 'metadata', error: error as Error })
        throw error // Stop on metadata save failure
      }

      // 3. Save certification data (if present) - this is optional and won't fail the whole save
      if (courseStructure._certificationData) {
        try {
          const certData = courseStructure._certificationData
          await updateCertification(
            certData.certification_uuid,
            certData.config,
            session.data?.tokens?.access_token
          )
          results.push({ success: true, operation: 'certification' })

          // Clear certification temp data after successful save
          dispatchCourse({
            type: 'mergePendingChanges',
            payload: { _certificationData: undefined }
          })
        } catch (error) {
          // Log but don't fail the entire save for certification errors
          console.error('Failed to save certification data:', error)
          results.push({ success: false, operation: 'certification', error: error as Error })
          toast.error(t('dashboard.courses.save.certification_error') || 'Failed to save certification settings')
        }
      }

      // All critical saves succeeded, now update caches
      if (cacheKey) {
        // Revalidate SWR cache with the latest data
        await mutate(cacheKey, courseStructure, { revalidate: false })
      }

      // Revalidate server-side cache
      await revalidateTags(['courses'], props.orgslug)

      // Mark as saved
      dispatchCourse({ type: 'setIsSaved' })
      dispatchCourse({ type: 'commitChanges' })

      // Refresh router to update any server components
      router.refresh()

      // Show success feedback
      const allSucceeded = results.every(r => r.success)
      if (allSucceeded) {
        toast.success(t('dashboard.courses.save.success') || 'Changes saved successfully')
      } else {
        const failedOps = results.filter(r => !r.success).map(r => r.operation)
        toast.success(
          t('dashboard.courses.save.partial_success', { failed: failedOps.join(', ') }) ||
          `Saved with some issues: ${failedOps.join(', ')}`
        )
      }

    } catch (error) {
      console.error('Save failed:', error)

      // Determine which operations failed
      const failedOps = results.filter(r => !r.success).map(r => r.operation)
      const successOps = results.filter(r => r.success).map(r => r.operation)

      // Set error state
      dispatchCourse({
        type: 'setSaveError',
        payload: `Failed to save: ${failedOps.join(', ')}`
      })

      // Show error feedback
      if (successOps.length > 0) {
        toast.error(
          t('dashboard.courses.save.partial_error', {
            success: successOps.join(', '),
            failed: failedOps.join(', ')
          }) ||
          `Partially saved (${successOps.join(', ')}), but failed: ${failedOps.join(', ')}`
        )
      } else {
        toast.error(t('dashboard.courses.save.error') || 'Failed to save changes')
      }

      // Don't rollback completely - keep the local state so user can retry
      // But mark as not saved so they know to try again
      dispatchCourse({ type: 'setIsNotSaved' })

    } finally {
      dispatchCourse({ type: 'setSaving', payload: false })
      saveInProgressRef.current = false
    }
  }, [
    saved,
    isSaving,
    courseStructure,
    course.courseOrder,
    cacheKey,
    withUnpublishedActivities,
    session.data?.tokens?.access_token,
    debounceManager,
    dispatchCourse,
    router,
    props.orgslug,
    t
  ])

  // Calculate the course order from structure
  const handleCourseOrder = useCallback((structure: any) => {
    if (!structure?.chapters) return

    const chapter_order_by_ids = structure.chapters.map((chapter: any) => ({
      chapter_id: chapter.id,
      activities_order_by_ids: chapter.activities?.map((activity: any) => ({
        activity_id: activity.id,
      })) || [],
    }))

    dispatchCourse({
      type: 'setCourseOrder',
      payload: { chapter_order_by_ids },
    })
  }, [dispatchCourse])

  // Initialize order on mount and when structure changes
  React.useEffect(() => {
    if (courseStructure?.chapters && saved) {
      handleCourseOrder(courseStructure)
    }
  }, [courseStructure?.chapters?.length, saved, handleCourseOrder])

  // Update order when structure changes and not saved
  React.useEffect(() => {
    if (courseStructure?.chapters && !saved) {
      handleCourseOrder(courseStructure)
    }
  }, [courseStructure, saved, handleCourseOrder])

  const saveError = course?.saveError

  return (
    <button
      className={
        `px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 transition-colors ` +
        (saved && !saveError
          ? 'text-neutral-500 cursor-default'
          : saveError
            ? 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'
            : 'bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer') +
        (isSaving ? ' opacity-50 cursor-not-allowed' : '')
      }
      onClick={saveCourseState}
      disabled={isSaving}
    >
      {isSaving ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : saved && !saveError ? (
        <Check className="w-4 h-4" />
      ) : saveError ? (
        <AlertCircle className="w-4 h-4" />
      ) : (
        <SaveAllIcon className="w-4 h-4" />
      )}
      <span>
        {isSaving
          ? t('dashboard.courses.save.saving')
          : saved && !saveError
            ? t('dashboard.courses.save.saved')
            : saveError
              ? t('dashboard.courses.save.retry_button')
              : t('dashboard.courses.save.save')}
      </span>
      {!saved && !saveError && !isSaving && (
        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 text-white rounded whitespace-nowrap">
          {t('dashboard.courses.save.unsaved')}
        </span>
      )}
    </button>
  )
}

export default SaveState
