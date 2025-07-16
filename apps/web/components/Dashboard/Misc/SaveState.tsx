'use client'
import { getAPIUrl } from '@services/config/config'
import { updateCourseOrderStructure } from '@services/courses/chapters'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  useCourse,
  useCourseDispatch,
} from '@components/Contexts/CourseContext'
import { Check, SaveAllIcon, Timer, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { mutate } from 'swr'
import { updateCourse } from '@services/courses/courses'
import { updateCertification } from '@services/courses/certifications'
import { useLHSession } from '@components/Contexts/LHSessionContext'

function SaveState(props: { orgslug: string }) {
  const [isLoading, setIsLoading] = useState(false)
  const course = useCourse() as any
  const session = useLHSession() as any;
  const router = useRouter()
  const saved = course ? course.isSaved : true
  const dispatchCourse = useCourseDispatch() as any
  const course_structure = course.courseStructure
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false
  const saveCourseState = async () => {
    if (saved || isLoading) return
    setIsLoading(true)
    try {
      // Course  order
      await changeOrderBackend()
      mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
      // Course metadata
      await changeMetadataBackend()
      mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
      // Certification data (if present)
      await saveCertificationData()
      await revalidateTags(['courses'], props.orgslug)
      dispatchCourse({ type: 'setIsSaved' })
    } finally {
      setIsLoading(false)
    }
  }

  //
  // Course Order
  const changeOrderBackend = async () => {
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    await updateCourseOrderStructure(
      course.courseStructure.course_uuid,
      course.courseOrder,
      session.data?.tokens?.access_token
    )
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
    dispatchCourse({ type: 'setIsSaved' })
  }

  // Course metadata
  const changeMetadataBackend = async () => {
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    await updateCourse(
      course.courseStructure.course_uuid,
      course.courseStructure,
      session.data?.tokens?.access_token
    )
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
    dispatchCourse({ type: 'setIsSaved' })
  }

  // Certification data
  const saveCertificationData = async () => {
    if (course.courseStructure._certificationData) {
      const certData = course.courseStructure._certificationData;
      try {
        await updateCertification(
          certData.certification_uuid,
          certData.config,
          session.data?.tokens?.access_token
        );
        console.log('Certification data saved successfully');
      } catch (error) {
        console.error('Failed to save certification data:', error);
        // Don't throw error to prevent breaking the main save flow
      }
    }
  }

  const handleCourseOrder = (course_structure: any) => {
    const chapters = course_structure.chapters
    const chapter_order_by_ids = chapters.map((chapter: any) => {
      return {
        chapter_id: chapter.id,
        activities_order_by_ids: chapter.activities.map((activity: any) => {
          return {
            activity_id: activity.id,
          }
        }),
      }
    })
    dispatchCourse({
      type: 'setCourseOrder',
      payload: { chapter_order_by_ids: chapter_order_by_ids },
    })
    dispatchCourse({ type: 'setIsNotSaved' })
  }

  const initOrderPayload = () => {
    if (course_structure && course_structure.chapters) {
      handleCourseOrder(course_structure)
      dispatchCourse({ type: 'setIsSaved' })
    }
  }

  const changeOrderPayload = () => {
    if (course_structure && course_structure.chapters) {
      handleCourseOrder(course_structure)
      dispatchCourse({ type: 'setIsNotSaved' })
    }
  }

  useEffect(() => {
    if (course_structure?.chapters) {
      initOrderPayload()
    }
    if (course_structure?.chapters && !saved) {
      changeOrderPayload()
    }
  }, [course_structure]) // This effect depends on the `course_structure` variable

  return (
    <div className="flex space-x-4">
      {saved ? (
        <></>
      ) : (
        <div className="text-gray-600 flex space-x-2 items-center antialiased">
          <Timer size={15} />
          <div>Unsaved changes</div>
        </div>
      )}
      <div
        className={
          `px-4 py-2 rounded-lg drop-shadow-md cursor-pointer flex space-x-2 items-center font-bold antialiased transition-all ease-linear ` +
          (saved
            ? 'bg-gray-600 text-white'
            : 'bg-black text-white border hover:bg-gray-900 ') +
          (isLoading ? 'opacity-50 cursor-not-allowed' : '')
        }
        onClick={saveCourseState}
      >
        {isLoading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : saved ? (
          <Check size={20} />
        ) : (
          <SaveAllIcon size={20} />
        )}
        {isLoading ? (
          <div className="">Saving...</div>
        ) : saved ? (
          <div className="">Saved</div>
        ) : (
          <div className="">Save</div>
        )}
      </div>
    </div>
  )
}

export default SaveState
