'use client'
import { useCourse, useCourseDispatch, getCourseMetaCacheKey } from '@components/Contexts/CourseContext'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import SaveState from './SaveState'
import { CourseOverviewParams } from 'app/orgs/[orgslug]/dash/courses/course/[courseuuid]/[subpage]/page'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import Image from 'next/image'
import EmptyThumbnailImage from '../../../public/empty_thumbnail.png'
import { BookCopy, Eye, Globe, GlobeLock, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { updateCourse } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import toast from 'react-hot-toast'
import { useState, useCallback } from 'react'

export function CourseOverviewTop({
  params,
}: {
  params: CourseOverviewParams
}) {
  const { t } = useTranslation()
  const course = useCourse() as any
  const dispatchCourse = useCourseDispatch() as any
  const org = useOrg() as any
  const session = useLHSession() as any
  const [isPublishing, setIsPublishing] = useState(false)

  const courseStructure = course?.courseStructure
  const isPublished = courseStructure?.published
  const withUnpublishedActivities = course?.withUnpublishedActivities ?? false

  // Use unified cache key
  const cacheKey = courseStructure?.course_uuid
    ? getCourseMetaCacheKey(courseStructure.course_uuid, withUnpublishedActivities)
    : null

  const togglePublishStatus = useCallback(async () => {
    if (isPublishing || !courseStructure?.course_uuid) return
    setIsPublishing(true)

    const newPublishedStatus = !isPublished
    const toastMessage = newPublishedStatus
      ? t('dashboard.courses.publishing')
      : t('dashboard.courses.unpublishing')
    const toastId = toast.loading(toastMessage)

    // Optimistically update local state
    const previousState = { ...courseStructure }
    dispatchCourse({
      type: 'mergePendingChanges',
      payload: { published: newPublishedStatus }
    })

    try {
      await updateCourse(
        courseStructure.course_uuid,
        { ...courseStructure, published: newPublishedStatus },
        session.data?.tokens?.access_token
      )

      // Update the SWR cache with the new state
      if (cacheKey) {
        await mutate(cacheKey, { ...courseStructure, published: newPublishedStatus }, { revalidate: false })
      }

      // Revalidate server-side cache
      await revalidateTags(['courses'], params.orgslug)

      toast.dismiss(toastId)
      toast.success(
        newPublishedStatus
          ? t('dashboard.courses.published_success')
          : t('dashboard.courses.unpublished_success')
      )
    } catch (error) {
      // Rollback on error
      dispatchCourse({
        type: 'mergePendingChanges',
        payload: { published: previousState.published }
      })

      toast.dismiss(toastId)
      toast.error(t('dashboard.courses.publish_error'))
    } finally {
      setIsPublishing(false)
    }
  }, [
    isPublishing,
    isPublished,
    courseStructure,
    cacheKey,
    session.data?.tokens?.access_token,
    dispatchCourse,
    params.orgslug,
    t
  ])

  if (!courseStructure) {
    return null
  }

  return (
    <>
      <div className="pt-6 pb-4">
        <Breadcrumbs items={[
          { label: t('courses.courses'), href: '/dash/courses', icon: <BookCopy size={14} /> },
          { label: courseStructure.name }
        ]} />
      </div>
      <div className="flex">
        <div className="flex py-3 grow items-center">
          <Link
            href={getUriWithOrg(org?.slug, '') + `/course/${params.courseuuid}`}
          >
            {courseStructure?.thumbnail_image ? (
              <img
                className="w-[100px] h-[57px] rounded-md drop-shadow-md"
                src={`${getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  'course_' + params.courseuuid,
                  courseStructure.thumbnail_image
                )}`}
                alt=""
              />
            ) : (
              <Image
                width={100}
                className="h-[57px] rounded-md drop-shadow-md"
                src={EmptyThumbnailImage}
                alt=""
              />
            )}
          </Link>
          <div className="flex flex-col course_metadata justify-center pl-5">
            <div className="text-gray-400 font-semibold text-sm">{t('dashboard.courses.overview_top.course_label')}</div>
            <div className="text-black font-bold text-xl -mt-1 first-letter:uppercase">
              {courseStructure.name}
            </div>
          </div>
        </div>
        <div className="flex items-center self-center rounded-lg shadow-sm shadow-neutral-300/40 ring-1 ring-neutral-200/60 overflow-hidden">
          <SaveState orgslug={params.orgslug} />
          <div className="w-px self-stretch bg-neutral-200/80" />
          <button
            onClick={togglePublishStatus}
            disabled={isPublishing}
            className={`group px-3.5 py-2 text-sm font-semibold flex items-center space-x-2 transition-colors ${
              isPublished
                ? 'bg-green-50/70 text-green-700 hover:bg-green-100/70'
                : 'bg-yellow-50/70 text-yellow-700 hover:bg-yellow-100/70'
            } ${isPublishing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {isPublishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPublished ? (
              <Globe className="w-4 h-4" />
            ) : (
              <GlobeLock className="w-4 h-4" />
            )}
            <span>
              {isPublishing
                ? t('dashboard.courses.processing')
                : isPublished
                  ? t('dashboard.courses.published')
                  : t('dashboard.courses.unpublished')
              }
            </span>
            {!isPublishing && (
              <span className={`inline-flex overflow-hidden max-w-0 group-hover:max-w-[150px] opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out`}>
                <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded whitespace-nowrap ${
                  isPublished
                    ? 'bg-green-200/80 text-green-800'
                    : 'bg-yellow-200/80 text-yellow-800'
                }`}>
                  {isPublished ? t('dashboard.courses.click_to_unpublish') : t('dashboard.courses.click_to_publish')}
                </span>
              </span>
            )}
          </button>
          <div className="w-px self-stretch bg-neutral-200/80" />
          <Link
            href={getUriWithOrg(org?.slug, '') + `/course/${params.courseuuid}`}
            target="_blank"
            className="px-3.5 py-2 text-sm font-semibold text-neutral-600 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors flex items-center space-x-2"
          >
            <Eye className="w-4 h-4" />
            <span>{t('dashboard.courses.preview')}</span>
          </Link>
        </div>
      </div>
    </>
  )
}
