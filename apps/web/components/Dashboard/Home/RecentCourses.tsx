'use client'
import React, { useMemo } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle, Clock, EyeSlash, PencilSimpleLine, Plus } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
  Chip,
  EmptyState,
  SectionCard,
  formatRelative,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { useHomeCourses } from './homeData'
import { CardLink, ListSkeleton } from './homeKit'

const RECENT_COURSES = 6

function updatedAt(course: any) {
  const time = new Date(course.update_date || course.creation_date || 0).getTime()
  return isNaN(time) ? 0 : time
}

export default function RecentCourses() {
  const { t } = useTranslation()
  const { data: coursesData, isLoading } = useHomeCourses()

  // Most recently edited first, whatever order the API returns.
  const courses = useMemo(
    () => [...(coursesData ?? [])].sort((a, b) => updatedAt(b) - updatedAt(a)).slice(0, RECENT_COURSES),
    [coursesData]
  )

  return (
    <SectionCard
      title={t('dashboard.home.recent_courses')}
      actions={<CardLink href="/dash/courses">{t('dashboard.home.view_all')}</CardLink>}
      className="overflow-hidden"
      bodyClassName="pt-3 pb-1"
    >
      {isLoading ? (
        <ListSkeleton rows={4} media="thumb" />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title={t('dashboard.home.no_courses_yet')}
          action={
            <Link href="/dash/courses?new=true" className={BTN_PRIMARY_SM}>
              <Plus size={14} weight="bold" />
              {t('dashboard.home.create_your_first_course')}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {courses.map((course: any) => (
            <CourseRow key={course.course_uuid} course={course} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function CourseRow({ course }: { course: any }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const courseId = course.course_uuid?.replace('course_', '')
  const href = `/dash/courses/course/${courseId}/general`
  const thumbnail = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
    : null
  const updated = formatRelative(course.update_date, i18n.language)
  const chapters = course.chapters_count

  const status = course.published ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>
      {t('courses.published')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={<EyeSlash size={12} />}>
      {t('dashboard.courses.home.draft')}
    </Chip>
  )

  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50/70 transition-colors">
      <Link prefetch={false} href={href} className="shrink-0" tabIndex={-1} aria-hidden>
        <ThumbnailImage src={thumbnail} alt="" className="w-16 sm:w-20 aspect-video rounded-lg ring-1 ring-black/5" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          prefetch={false}
          href={href}
          dir="auto"
          className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2"
        >
          {course.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span className="sm:hidden">{status}</span>
          {updated && (
            <span className="inline-flex items-center gap-1" title={course.update_date}>
              <Clock size={12} className="text-neutral-400" />
              {updated}
            </span>
          )}
          {chapters !== undefined && chapters !== null && (
            <span>
              {chapters} {chapters !== 1 ? t('dashboard.home.chapters') : t('dashboard.home.chapter')}
            </span>
          )}
        </div>
      </div>
      <div className="hidden sm:block shrink-0">{status}</div>
      <Link
        prefetch={false}
        href={`/dash/courses/course/${courseId}/content`}
        className={`${BTN_SECONDARY_SM} shrink-0`}
        aria-label={t('dashboard.courses.home.edit')}
        title={t('dashboard.courses.home.edit')}
      >
        <PencilSimpleLine size={14} />
        <span className="hidden sm:inline">{t('dashboard.courses.home.edit')}</span>
      </Link>
    </li>
  )
}
