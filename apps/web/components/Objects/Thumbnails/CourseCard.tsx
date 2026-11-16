'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { AvatarStack, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'

export type CourseCardCourse = {
  course_uuid: string
  name: string
  description?: string | null
  thumbnail_image?: string | null
  update_date?: string | null
  authors?: Array<{
    user: {
      user_uuid: string
      avatar_image?: string | null
      first_name?: string | null
      last_name?: string | null
      username?: string | null
    }
    authorship_status?: string
  }>
}

export function courseCardThumbnail(orgUuid: string | undefined, course: CourseCardCourse) {
  return course.thumbnail_image && orgUuid
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : null
}

function authorsOf(course: CourseCardCourse) {
  return (course.authors || [])
    .filter((a) => !a.authorship_status || a.authorship_status === 'ACTIVE')
    .map((a) => ({
      key: a.user.user_uuid,
      src: a.user.avatar_image ? getUserAvatarMediaDirectory(a.user.user_uuid, a.user.avatar_image) : '',
      label: [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username || '',
    }))
}

/**
 * The one course card used everywhere a course is shown as a tile: the
 * dashboard list, the public catalog, landing pages, the library, a learner's
 * own courses and their trail. Callers add what is specific to them through
 * the slots (status chips, selection, an actions menu, a call to action, a
 * progress bar) so the card itself always looks the same.
 */
export default function CourseCard({
  course,
  orgUuid,
  href,
  badges,
  topStart,
  topEnd,
  footerEnd,
  footer,
  selected = false,
  priority = false,
  showMeta = true,
  onOpen,
  onWarm,
  className = '',
}: {
  course: CourseCardCourse
  orgUuid?: string
  href: string
  /** Chips over the bottom of the cover (status, visibility, "Free"…). */
  badges?: React.ReactNode
  /** Top-left over the cover, e.g. a selection checkbox. Shown on hover unless `selected`. */
  topStart?: React.ReactNode
  /** Top-right over the cover, e.g. an actions menu. Shown on hover. */
  topEnd?: React.ReactNode
  /** End of the footer row (quick actions, "Start learning"). */
  footerEnd?: React.ReactNode
  /** Replaces the authors + date footer, e.g. with a progress bar. */
  footer?: React.ReactNode
  selected?: boolean
  priority?: boolean
  showMeta?: boolean
  onOpen?: () => void
  onWarm?: () => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const updated = formatRelative(course.update_date, i18n.language)
  const authors = authorsOf(course)

  return (
    <div
      data-kbd-item=""
      onMouseEnter={onWarm}
      onFocus={onWarm}
      className={`lh-t-card group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        selected ? 'ring-2 ring-neutral-900' : ''
      } ${className}`}
    >
      <Link prefetch={false} href={href} onClick={onOpen} className="lh-t-thumb block relative aspect-video overflow-hidden bg-neutral-100">
        <ThumbnailImage
          src={courseCardThumbnail(orgUuid, course)}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        {badges && <div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5">{badges}</div>}
      </Link>

      {topStart && (
        <div
          className={`absolute top-2.5 start-2.5 z-10 transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          }`}
        >
          {topStart}
        </div>
      )}

      {topEnd && (
        <div className="absolute top-2 end-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
          <div className="rounded-lg bg-white/95 backdrop-blur shadow-sm">{topEnd}</div>
        </div>
      )}

      <div className="lh-t-card-body flex flex-col flex-1 p-4 gap-1">
        <Link
          prefetch={false}
          href={href}
          onClick={onOpen}
          dir="auto"
          lang={(course as any).locale || undefined}
          className="lh-t-heading text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
        >
          {course.name}
        </Link>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto" lang={course.description ? (course as any).locale || undefined : undefined}>
          {course.description || t('dashboard.courses.home.no_description')}
        </p>
        {(footer || showMeta || footerEnd) && (
          <div className="mt-auto pt-3">
            {footer ?? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {showMeta && <AvatarStack people={authors} size={22} />}
                  {showMeta && updated && <span className="text-xs text-neutral-400 truncate">{updated}</span>}
                </div>
                {footerEnd && <div className="flex items-center gap-0.5 shrink-0">{footerEnd}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
