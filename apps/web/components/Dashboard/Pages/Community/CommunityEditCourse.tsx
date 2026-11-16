'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowSquareOut, ArrowsLeftRight, BookOpen, Check, LinkBreak, LinkSimple, Warning } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { linkCommunityToCourse, unlinkCommunityFromCourse } from '@services/communities/communities'
import { getAllOrgCourses } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { searchMatchesAny } from '@/lib/search/normalize'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  SectionCard,
  buttonClass,
} from '@components/Dashboard/Shared/DashKit/DashKit'

interface Course {
  id: number
  course_uuid: string
  name: string
  description: string
  thumbnail_image?: string
}

const errorMessage = (err: any, fallback: string) =>
  (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
  (typeof err?.detail === 'string' && err.detail) ||
  fallback

const CommunityEditCourse: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const community = useCommunity()?.community
  const dispatch = useCommunityDispatch()
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  const { data: coursesData, isLoading: isLoadingCourses } = useQuery({
    queryKey: queryKeys.courses.list(org?.slug ?? ''),
    queryFn: () => getAllOrgCourses(org.slug, accessToken, false),
    enabled: !!(org?.slug && accessToken),
    staleTime: 60_000,
  })
  const courses: Course[] = Array.isArray(coursesData) ? coursesData : []

  if (!community) return null

  const linkedCourse = courses.find((c) => c.id === community.course_id)

  const afterChange = (courseId: number | null) => {
    dispatch?.({ type: 'setCommunity', payload: { ...community, course_id: courseId } })
    queryClient.invalidateQueries({ queryKey: queryKeys.community.detail(community.community_uuid) })
    queryClient.invalidateQueries({ queryKey: queryKeys.community.list(org.id) })
    revalidateTags(['communities'], org.slug)
  }

  const handleLink = async (course: Course) => {
    const loadingToast = toast.loading(t('dashboard.courses.communities.course.toasts.linking'))
    try {
      await linkCommunityToCourse(community.community_uuid, course.course_uuid, accessToken)
      afterChange(course.id)
      toast.success(t('dashboard.courses.communities.course.toasts.link_success'), { id: loadingToast })
      return true
    } catch (error) {
      console.error('Failed to link course:', error)
      toast.error(errorMessage(error, t('dashboard.courses.communities.course.toasts.link_error')), { id: loadingToast })
      return false
    }
  }

  const handleUnlink = async () => {
    const loadingToast = toast.loading(t('dashboard.courses.communities.course.toasts.unlinking'))
    try {
      await unlinkCommunityFromCourse(community.community_uuid, accessToken)
      afterChange(null)
      toast.success(t('dashboard.courses.communities.course.toasts.unlink_success'), { id: loadingToast })
    } catch (error) {
      console.error('Failed to unlink course:', error)
      toast.error(t('dashboard.courses.communities.course.toasts.unlink_error'), { id: loadingToast })
    }
  }

  const courseThumb = (course: Course) =>
    course.thumbnail_image && org?.org_uuid
      ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
      : null

  return (
    <>
      <SectionCard
        icon={<BookOpen size={18} />}
        title={t('dashboard.courses.communities.course.title')}
        description={t('dashboard.courses.communities.course.subtitle')}
      >
        {community.course_id && isLoadingCourses ? (
          <div className="flex items-center gap-4 rounded-xl ring-1 ring-inset ring-neutral-100 p-3 animate-pulse">
            <div className="w-24 aspect-video rounded-lg bg-neutral-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 rounded bg-neutral-100" />
              <div className="h-3 w-24 rounded bg-neutral-100" />
            </div>
          </div>
        ) : community.course_id && linkedCourse ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl ring-1 ring-inset ring-neutral-200/80 p-3">
            <ThumbnailImage
              src={courseThumb(linkedCourse)}
              alt=""
              className="w-full sm:w-28 aspect-video rounded-lg object-cover ring-1 ring-black/5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 truncate" dir="auto">{linkedCourse.name}</p>
              {linkedCourse.description && (
                <p className="text-xs text-neutral-500 line-clamp-2 mt-0.5" dir="auto">{linkedCourse.description}</p>
              )}
              <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check size={12} weight="bold" />
                {t('dashboard.courses.communities.course.currently_linked')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <Link
                href={getUriWithOrg(org.slug, `/dash/courses/course/${linkedCourse.course_uuid.replace('course_', '')}/general`)}
                className={buttonClass('ghost', 'md')}
              >
                <ArrowSquareOut size={14} />
                {t('communities.dash.course.open_course')}
              </Link>
              <Button icon={<ArrowsLeftRight size={14} />} onClick={() => setPickerOpen(true)}>
                {t('communities.dash.course.change')}
              </Button>
              <Button variant="danger-ghost" icon={<LinkBreak size={14} />} onClick={() => setConfirmUnlink(true)}>
                {t('dashboard.courses.communities.course.unlink')}
              </Button>
            </div>
          </div>
        ) : community.course_id ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Warning size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {t('dashboard.courses.communities.course.course_linked_id', { id: community.course_id })}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">{t('dashboard.courses.communities.course.course_not_found')}</p>
              </div>
            </div>
            <Button variant="danger-ghost" icon={<LinkBreak size={14} />} onClick={() => setConfirmUnlink(true)}>
              {t('dashboard.courses.communities.course.unlink')}
            </Button>
          </div>
        ) : (
          <div className="rounded-xl ring-1 ring-inset ring-neutral-100">
            <EmptyState
              icon={<LinkSimple size={22} />}
              title={t('communities.dash.course.none_title')}
              description={t('communities.dash.course.none_description')}
              action={
                <Button variant="primary" icon={<LinkSimple size={14} />} onClick={() => setPickerOpen(true)}>
                  {t('dashboard.courses.communities.course.link_button')}
                </Button>
              }
            />
          </div>
        )}
      </SectionCard>

      <CoursePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        courses={courses}
        isLoading={isLoadingCourses}
        currentId={community.course_id}
        thumbOf={courseThumb}
        onLink={handleLink}
      />
      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title={t('communities.dash.course.unlink_title')}
        message={t('communities.dash.course.unlink_message')}
        confirmLabel={t('dashboard.courses.communities.course.unlink')}
        onConfirm={handleUnlink}
      />
    </>
  )
}

function CoursePickerDialog({
  open,
  onOpenChange,
  courses,
  isLoading,
  currentId,
  thumbOf,
  onLink,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  courses: Course[]
  isLoading: boolean
  currentId: number | null
  thumbOf: (_course: Course) => string | null
  onLink: (_course: Course) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const filtered = useMemo(
    () => courses.filter((c) => c.id !== currentId && searchMatchesAny([c.name, c.description], query)),
    [courses, currentId, query]
  )
  const selectedCourse = courses.find((c) => c.course_uuid === selected)

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setQuery('')
      setSelected(null)
    }
  }

  const submit = async () => {
    if (!selectedCourse) return
    setSubmitting(true)
    const ok = await onLink(selectedCourse)
    setSubmitting(false)
    if (ok) close(false)
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      icon={<LinkSimple size={16} />}
      size="md"
      preventClose={submitting}
      dialogTitle={t('dashboard.courses.communities.course.title')}
      dialogDescription={t('communities.dash.course.picker_description')}
      dialogContent={
        <div className="flex flex-col gap-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('dashboard.courses.communities.course.search_placeholder')}
          />
          <div className="max-h-[360px] overflow-y-auto rounded-xl ring-1 ring-inset ring-neutral-100">
            {isLoading ? (
              <div className="divide-y divide-neutral-100 animate-pulse">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-16 aspect-video rounded-md bg-neutral-100" />
                    <div className="h-3.5 w-40 rounded bg-neutral-100" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<BookOpen size={22} />} title={t('dashboard.courses.communities.course.no_courses')} />
            ) : (
              <ul role="radiogroup" className="divide-y divide-neutral-100">
                {filtered.map((course) => {
                  const isSelected = selected === course.course_uuid
                  return (
                    <li key={course.course_uuid}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelected(course.course_uuid)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-start transition-colors ${
                          isSelected ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'
                        }`}
                      >
                        <ThumbnailImage
                          src={thumbOf(course)}
                          alt=""
                          className="w-16 aspect-video rounded-md object-cover ring-1 ring-black/5 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">{course.name}</span>
                          {course.description && (
                            <span className="block text-xs text-neutral-500 truncate" dir="auto">{course.description}</span>
                          )}
                        </span>
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-neutral-900 text-white' : 'ring-1 ring-inset ring-neutral-300'
                          }`}
                        >
                          {isSelected && <Check size={12} weight="bold" />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="text-xs text-neutral-400">{t('communities.dash.course.picker_hint')}</p>
        </div>
      }
      footer={
        <>
          <Button onClick={() => close(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={submitting} disabled={!selectedCourse}>
            {t('dashboard.courses.communities.course.link_button')}
          </Button>
        </>
      }
    />
  )
}

export default CommunityEditCourse
