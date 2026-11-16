'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle, EyeSlash, PencilSimpleLine, Globe, Lock, SlidersHorizontal } from '@phosphor-icons/react'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import SharedCourseCard from '@components/Objects/Thumbnails/CourseCard'
import { AvatarStack, Chip, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { getCourseMetadata, getCourseRights } from '@services/courses/courses'
import { queryKeys } from '@/lib/query/keys'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'
import { CourseActionsMenu, DashCourse, cleanCourseUuid, courseEditorHref } from './courseActions'

// Desktop table layout, the same subgrid trick as the assignments list: the
// card is the grid and every row spans it, so columns line up across rows.
export const COURSE_TABLE_GRID =
  'lg:grid lg:grid-cols-[auto_minmax(0,2.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] lg:gap-x-4'
export const COURSE_ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

type ItemProps = {
  course: DashCourse
  orgslug: string
  orgUuid: string
  selected: boolean
  selectable: boolean
  onToggleSelect: (uuid: string, shiftKey: boolean) => void
  onChanged: () => void
}

function thumbnailSrc(orgUuid: string, course: DashCourse) {
  return course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : '/empty_thumbnail.png'
}

function authorsOf(course: DashCourse) {
  return (course.authors || [])
    .filter((a) => a.authorship_status === 'ACTIVE')
    .map((a) => ({
      key: a.user.user_uuid,
      src: a.user.avatar_image ? getUserAvatarMediaDirectory(a.user.user_uuid, a.user.avatar_image) : '',
      label: [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username,
    }))
}

// Warm the editor before the click: its route, the course structure and the
// rights check it waits on, so opening a course feels instant.
function useWarmEditor(course: DashCourse, orgslug: string) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const warmed = React.useRef(false)
  return React.useCallback(() => {
    if (warmed.current || !accessToken) return
    warmed.current = true
    const uuid = cleanCourseUuid(course.course_uuid)
    prefetchRouteFull(router, courseEditorHref(orgslug, course))
    queryClient.prefetchQuery({
      queryKey: ['course', uuid, 'meta', 'withUnpublished'],
      queryFn: () => getCourseMetadata(uuid, {}, accessToken, { withUnpublishedActivities: true }),
      staleTime: 60_000,
    })
    queryClient.prefetchQuery({
      // Same entry as useCourseRights: bare key, prefixed id on the wire.
      queryKey: queryKeys.courses.rights(uuid),
      queryFn: () => getCourseRights(`course_${uuid}`, accessToken),
      staleTime: 60_000,
    })
  }, [accessToken, course, orgslug, queryClient, router])
}

export function StatusChip({ published }: { published?: boolean }) {
  const { t } = useTranslation()
  return published ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('courses.published')}</Chip>
  ) : (
    <Chip tone="neutral" icon={<EyeSlash size={12} />}>{t('dashboard.courses.home.draft')}</Chip>
  )
}

export function VisibilityChip({ isPublic }: { isPublic?: boolean }) {
  const { t } = useTranslation()
  return isPublic ? (
    <Chip tone="sky" icon={<Globe size={12} />}>{t('courses.public')}</Chip>
  ) : (
    <Chip tone="violet" icon={<Lock size={12} />}>{t('courses.private')}</Chip>
  )
}

function SelectBox({
  selected,
  onToggle,
  className = '',
}: {
  selected: boolean
  onToggle: (shiftKey: boolean) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? t('courses.deselect_course') : t('courses.select_course')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle(e.shiftKey)
      }}
      className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0 ${
        selected ? 'bg-neutral-900 text-white' : 'bg-white ring-1 ring-inset ring-neutral-300 hover:ring-neutral-500'
      } ${className}`}
    >
      {selected && <Check size={13} weight="bold" />}
    </button>
  )
}

export function CourseCard({ course, orgslug, orgUuid, selected, selectable, onToggleSelect, onChanged }: ItemProps) {
  const { t } = useTranslation()
  const warm = useWarmEditor(course, orgslug)
  const href = courseEditorHref(orgslug, course)
  const quickLink =
    'h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors'

  return (
    <SharedCourseCard
      course={course}
      orgUuid={orgUuid}
      href={href}
      selected={selected}
      onWarm={warm}
      badges={
        <>
          <StatusChip published={course.published} />
          {!course.public && (
            <span
              title={t('courses.private')}
              className="w-6 h-6 rounded-full bg-white/90 backdrop-blur text-violet-600 flex items-center justify-center"
            >
              <Lock size={12} />
            </span>
          )}
        </>
      }
      topStart={
        selectable ? (
          <SelectBox selected={selected} onToggle={(shift) => onToggleSelect(course.course_uuid, shift)} className="shadow-sm" />
        ) : undefined
      }
      topEnd={
        <AuthenticatedClientElement action="update" ressourceType="courses" checkMethod="roles" orgId={course.org_id}>
          <CourseActionsMenu course={course} orgslug={orgslug} onChanged={onChanged} />
        </AuthenticatedClientElement>
      }
      footerEnd={
        <>
          <Link
            prefetch={false}
            href={courseEditorHref(orgslug, course, 'content')}
            title={t('courses.edit_content')}
            aria-label={t('courses.edit_content')}
            className={quickLink}
          >
            <PencilSimpleLine size={15} />
          </Link>
          <Link prefetch={false} href={href} title={t('common.settings')} aria-label={t('common.settings')} className={quickLink}>
            <SlidersHorizontal size={15} />
          </Link>
        </>
      }
    />
  )
}

export function CourseRow({ course, orgslug, orgUuid, selected, selectable, onToggleSelect, onChanged }: ItemProps) {
  const { t, i18n } = useTranslation()
  const warm = useWarmEditor(course, orgslug)
  const href = courseEditorHref(orgslug, course)
  const updated = formatRelative(course.update_date, i18n.language)
  const authors = authorsOf(course)

  return (
    <li
      onMouseEnter={warm}
      onFocus={warm}
      className={`group relative flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors ${
        selected ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'
      } ${COURSE_ROW_GRID}`}
    >
      <div className="flex items-center">
        {selectable ? (
          <SelectBox selected={selected} onToggle={(shift) => onToggleSelect(course.course_uuid, shift)} />
        ) : (
          <span className="w-5" />
        )}
      </div>

      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Link prefetch={false} href={href} className="shrink-0">
          <ThumbnailImage
            src={thumbnailSrc(orgUuid, course)}
            loading="lazy"
            className="w-16 sm:w-20 aspect-video rounded-lg ring-1 ring-black/5"
          />
        </Link>
        <div className="min-w-0">
          <Link
            prefetch={false}
            href={href}
            dir="auto"
            className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
          >
            {course.name}
          </Link>
          <p className="text-xs text-neutral-500 truncate" dir="auto">
            {course.description || t('dashboard.courses.home.no_description')}
          </p>
          <div className="lg:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusChip published={course.published} />
            <VisibilityChip isPublic={course.public} />
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <StatusChip published={course.published} />
      </div>
      <div className="hidden lg:block">
        <VisibilityChip isPublic={course.public} />
      </div>
      <div className="hidden lg:block">
        {authors.length ? <AvatarStack people={authors} size={24} /> : <span className="text-sm text-neutral-300">—</span>}
      </div>
      <div className="hidden lg:block text-sm text-neutral-600 truncate" title={course.update_date}>
        {updated ?? '—'}
      </div>

      <div className="flex items-center gap-1 justify-end shrink-0">
        <Link
          prefetch={false}
          href={courseEditorHref(orgslug, course, 'content')}
          className={buttonClass('secondary', 'sm', 'hidden sm:inline-flex')}
        >
          <PencilSimpleLine size={14} />
          {t('dashboard.courses.home.edit')}
        </Link>
        <AuthenticatedClientElement action="update" ressourceType="courses" checkMethod="roles" orgId={course.org_id}>
          <CourseActionsMenu course={course} orgslug={orgslug} onChanged={onChanged} />
        </AuthenticatedClientElement>
      </div>
    </li>
  )
}

export function CourseCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-video bg-neutral-100" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-neutral-100 rounded w-3/4" />
        <div className="h-3 bg-neutral-100 rounded w-full" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
    </div>
  )
}

export function CourseRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 animate-pulse lg:col-span-full">
      <div className="w-5 h-5 rounded-md bg-neutral-100" />
      <div className="w-20 aspect-video rounded-lg bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
      <div className="hidden sm:block h-6 w-20 bg-neutral-100 rounded-full" />
    </div>
  )
}
