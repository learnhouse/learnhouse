'use client'
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import SaveState from './SaveState'
import type { CourseOverviewParams } from 'app/orgs/[orgslug]/dash/courses/course/[courseuuid]/[subpage]/page'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import { ArrowLeft, Books, CheckCircle, Eye, EyeSlash, Globe, GlobeX, Users } from '@phosphor-icons/react'
import { useRegisterAtlasPageContext } from '@ee/components/Atlas/AtlasMiniContext'
import AtlasToggleButton from '@ee/components/Atlas/AtlasToggleButton'
import { useTranslation } from 'react-i18next'
import { updateCourse } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { revalidateTags } from '@services/utils/ts/requests'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import toast from 'react-hot-toast'
import { useState, useCallback } from 'react'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Button, buttonClass, Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CourseLanguageSwitcher } from '@components/Dashboard/Pages/Course/EditCourseLanguages/CourseLanguageSwitcher'

export function CourseOverviewTop({
  params,
}: {
  params: CourseOverviewParams
}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const course = useCourse() as any
  const dispatchCourse = useCourseDispatch() as any
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const [isPublishing, setIsPublishing] = useState(false)

  const courseStructure = course?.courseStructure
  const isPublished = courseStructure?.published

  // Tell Atlas which course the user is viewing so the agent can pre-focus
  // it and skip the "which course?" round-trip on terse messages like
  // "fill this please". Cleared automatically on unmount.
  useRegisterAtlasPageContext(
    courseStructure?.course_uuid
      ? {
          course_uuid: courseStructure.course_uuid,
          course_name: courseStructure.name,
        }
      : null,
  )

  const isAIEnabled = org?.config?.config?.resolved_features?.ai?.enabled ?? org?.config?.config?.features?.ai?.enabled !== false

  const togglePublishStatus = useCallback(async () => {
    if (isPublishing || !courseStructure?.course_uuid) return
    setIsPublishing(true)

    const newPublishedStatus = !isPublished
    const toastMessage = newPublishedStatus
      ? t('dashboard.courses.publishing')
      : t('dashboard.courses.unpublishing')
    const toastId = toast.loading(toastMessage)

    // Optimistic, and not an unsaved edit: publishing saves on its own.
    const previousState = { ...courseStructure }
    dispatchCourse({ type: 'patchStructure', payload: { published: newPublishedStatus } })

    try {
      await updateCourse(
        courseStructure.course_uuid,
        { published: newPublishedStatus },
        session.data?.tokens?.access_token
      )

      // Invalidate course meta cache so other components see the update
      queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(params.courseuuid) })
      queryClient.invalidateQueries({ queryKey: ['course', params.courseuuid, 'meta'] })

      // Revalidate server-side cache
      await revalidateTags(['courses'], params.orgslug)

      track(AnalyticsEvent.CoursePublishedToggled, { new_published_status: newPublishedStatus })

      toast.dismiss(toastId)
      toast.success(
        newPublishedStatus
          ? t('dashboard.courses.published_success')
          : t('dashboard.courses.unpublished_success')
      )
    } catch (_error) {
      // Rollback on error
      dispatchCourse({ type: 'patchStructure', payload: { published: previousState.published } })

      toast.dismiss(toastId)
      toast.error(t('dashboard.courses.publish_error'))
    } finally {
      setIsPublishing(false)
    }
  }, [
    isPublishing,
    isPublished,
    courseStructure,
    queryClient,
    session.data?.tokens?.access_token,
    dispatchCourse,
    params.orgslug,
    params.courseuuid,
    track,
    t
  ])

  // Same footprint as the loaded header, so nothing jumps when data arrives.
  if (!courseStructure || course?.isLoading) {
    return (
      <div className="flex flex-col gap-4 pt-4 sm:pt-6 animate-pulse" aria-busy="true">
        <div className="h-5 w-48 rounded bg-neutral-100" />
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden sm:block w-7 h-7 rounded-md bg-neutral-100" />
          <div className="w-16 sm:w-20 aspect-video rounded-lg bg-neutral-100" />
          <div className="space-y-2">
            <div className="h-6 w-56 max-w-[50vw] rounded bg-neutral-200" />
            <div className="flex gap-1.5">
              <div className="h-6 w-16 rounded-full bg-neutral-100" />
              <div className="h-6 w-20 rounded-full bg-neutral-100" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const courseHref = getUriWithOrg(org?.slug, '') + `/course/${params.courseuuid}`

  // Laid out by the header's own width (a container query), not the
  // viewport's: the Atlas side panel can take 460px of a wide screen. Narrow:
  // title on its own line, actions below. One row: the title keeps at least
  // ~12 characters and secondary labels collapse to icons first.
  return (
    <div className="@container/courseheader flex flex-col gap-4 pt-4 sm:pt-6">
      <Breadcrumbs items={[
        { label: t('courses.courses'), href: '/dash/courses', icon: <Books size={14} /> },
        { label: courseStructure.name }
      ]} />
      <div className="flex flex-col @3xl/courseheader:flex-row @3xl/courseheader:items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 @3xl/courseheader:flex-1">
          <Link
            href={getUriWithOrg(params.orgslug, '/dash/courses')}
            aria-label={t('dashboard.courses.editor.header.back')}
            title={t('dashboard.courses.editor.header.back')}
            className={`max-sm:hidden @max-md/courseheader:hidden shrink-0 ${buttonClass('secondary', 'icon')}`}
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
          </Link>
          <Link href={courseHref} className="shrink-0 @max-xs/courseheader:hidden">
            {/* Falls back to the placeholder when there is no image or it fails to load. */}
            <ThumbnailImage
              className="w-16 sm:w-20 aspect-video rounded-lg ring-1 ring-black/5 object-cover"
              loading="eager"
              src={
                courseStructure?.thumbnail_image
                  ? getCourseThumbnailMediaDirectory(
                      org?.org_uuid,
                      'course_' + params.courseuuid,
                      courseStructure.thumbnail_image
                    )
                  : null
              }
              alt={courseStructure?.name || ''}
            />
          </Link>
          <div className="min-w-[12ch] flex-1">
            <h1 className="text-xl @md/courseheader:text-2xl font-bold tracking-tight text-neutral-900 truncate" title={courseStructure.name}>
              {courseStructure.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {isPublished ? (
                <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('dashboard.courses.published')}</Chip>
              ) : (
                <Chip tone="neutral" icon={<EyeSlash size={12} />}>{t('dashboard.courses.editor.header.draft')}</Chip>
              )}
              {courseStructure.public ? (
                <Chip tone="sky" icon={<Globe size={12} />}>{t('dashboard.courses.access.public.title')}</Chip>
              ) : (
                <Chip tone="violet" icon={<Users size={12} />}>{t('dashboard.courses.access.users_only.title')}</Chip>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 min-w-0">
          <SaveState orgslug={params.orgslug} />
          <CourseLanguageSwitcher courseUuid={courseStructure.course_uuid} />
          <Link
            href={courseHref}
            target="_blank"
            aria-label={t('dashboard.courses.preview')}
            title={t('dashboard.courses.preview')}
            className={buttonClass('secondary', 'md')}
          >
            <Eye size={15} />
            <span className="hidden @md/courseheader:inline @3xl/courseheader:hidden @5xl/courseheader:inline">{t('dashboard.courses.preview')}</span>
          </Link>
          <Button
            variant={isPublished ? 'secondary' : 'primary'}
            onClick={togglePublishStatus}
            loading={isPublishing}
            icon={isPublished ? <GlobeX size={15} /> : <Globe size={15} />}
            aria-label={isPublished ? t('dashboard.courses.ai_index.unpublish_course') : t('dashboard.courses.ai_index.publish_course')}
            title={isPublished ? t('dashboard.courses.click_to_unpublish') : t('dashboard.courses.click_to_publish')}
          >
            {isPublishing
              ? t('dashboard.courses.processing')
              : isPublished
                ? t('dashboard.courses.ai_index.unpublish_course')
                : t('dashboard.courses.ai_index.publish_course')}
          </Button>
          {isAIEnabled && (
            <AtlasToggleButton
              course={{ uuid: courseStructure.course_uuid, name: courseStructure.name }}
              tab={params.subpage}
            />
          )}
        </div>
      </div>
    </div>
  )
}
