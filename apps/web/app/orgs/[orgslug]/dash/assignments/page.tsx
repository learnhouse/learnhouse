'use client';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { getAssignmentsFromACourse } from '@services/courses/assignments';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { swrFetcher } from '@services/utils/ts/requests';
import {
  ALargeSmall,
  Backpack,
  Calendar,
  CheckCircle2,
  EyeOff,
  GalleryVerticalEnd,
  GraduationCap,
  Hash,
  Inbox,
  Layers2,
  Percent,
  Search,
  Shield,
  ThumbsUp,
  UserRoundPen,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react'
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';

type StatusFilter = 'all' | 'published' | 'drafts';

// Skeuomorphic badge color presets. Each value combines a vertical gradient
// (lighter at the top, slightly darker at the bottom), a thin colored ring
// for the "edge" of the pill, an inset white highlight for the lifted feel,
// and a soft colored drop shadow tinted to match the badge color. Keep the
// shapes consistent across all badges so they feel like a set.
const BADGE_BASE =
  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ring-1 ring-inset whitespace-nowrap'

const BADGE_VIOLET =
  'bg-gradient-to-b from-violet-50 to-violet-100 text-violet-700 ring-violet-300/40 shadow-[0_1px_2px_rgba(139,92,246,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'
const BADGE_BLUE =
  'bg-gradient-to-b from-blue-50 to-blue-100 text-blue-700 ring-blue-300/40 shadow-[0_1px_2px_rgba(59,130,246,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'
const BADGE_EMERALD =
  'bg-gradient-to-b from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-300/40 shadow-[0_1px_2px_rgba(16,185,129,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'
const BADGE_AMBER =
  'bg-gradient-to-b from-amber-50 to-amber-100 text-amber-700 ring-amber-300/40 shadow-[0_1px_2px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'
const BADGE_ROSE =
  'bg-gradient-to-b from-rose-50 to-rose-100 text-rose-700 ring-rose-300/40 shadow-[0_1px_2px_rgba(244,63,94,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'
const BADGE_CYAN =
  'bg-gradient-to-b from-cyan-50 to-cyan-100 text-cyan-700 ring-cyan-300/40 shadow-[0_1px_2px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]'

// Inline lookup table for grading-type badges. Same colors as the assignment
// editor's header badges so the design language stays consistent.
const GRADING_TYPE_BADGE: Record<string, { icon: React.ReactNode; labelKey: string; color: string }> = {
  ALPHABET: { icon: <ALargeSmall size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet', color: BADGE_VIOLET },
  NUMERIC: { icon: <Hash size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.numeric', color: BADGE_BLUE },
  PERCENTAGE: { icon: <Percent size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.percentage', color: BADGE_EMERALD },
  PASS_FAIL: { icon: <ThumbsUp size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.pass_fail', color: BADGE_AMBER },
  GPA_SCALE: { icon: <GraduationCap size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.gpa_scale', color: BADGE_ROSE },
};

function AssignmentsHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any;
  const { data: courses } = useSWR(
    org?.slug && access_token ? `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/50` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  // Fetch all course assignments in a single SWR call to avoid N+1 requests
  const courseUuids = useMemo(() => courses?.map((c: any) => c.course_uuid) || [], [courses])
  const { data: courseAssignments } = useSWR(
    courseUuids.length > 0 && access_token ? ['assignments-all', ...courseUuids] : null,
    async () => {
      const results = await Promise.all(
        courseUuids.map((uuid: string) => getAssignmentsFromACourse(uuid, access_token))
      )
      return results.map((res: any) => res.data)
    },
    { revalidateOnFocus: false }
  )

  // === Filter / search state ===
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [autoGradedOnly, setAutoGradedOnly] = useState(false)

  // === Stats — computed from the unfiltered data ===
  const stats = useMemo(() => {
    const allAssignments: any[] = (courseAssignments || []).flat()
    return {
      total: allAssignments.length,
      published: allAssignments.filter((a: any) => a.published).length,
      drafts: allAssignments.filter((a: any) => !a.published).length,
      auto_graded: allAssignments.filter((a: any) => a.auto_grading).length,
    }
  }, [courseAssignments])

  // === Filtering ===
  // Match an assignment against the active filters. Returns true if it should be shown.
  const matchesFilters = (assignment: any) => {
    // Search by title or description (case-insensitive)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const title = (assignment.title || '').toLowerCase()
      const desc = (assignment.description || '').toLowerCase()
      if (!title.includes(q) && !desc.includes(q)) return false
    }
    // Status pill
    if (statusFilter === 'published' && !assignment.published) return false
    if (statusFilter === 'drafts' && assignment.published) return false
    // Auto-graded toggle
    if (autoGradedOnly && !assignment.auto_grading) return false
    return true
  }

  // Build the filtered course rows. Each entry has { course, assignments } where
  // assignments has been filtered. Courses with zero assignments are always
  // hidden — empty courses are noise on this dashboard, the teacher uses the
  // course editor for those.
  const filteredCourseRows = useMemo(() => {
    if (!courseAssignments || !courses) return []
    return courseAssignments
      .map((assignments: any[], index: number) => {
        const filtered = (assignments || []).filter(matchesFilters)
        return { course: courses[index], assignments: filtered, originalCount: (assignments || []).length }
      })
      .filter((r: any) => r.assignments.length > 0)
  }, [courseAssignments, courses, searchQuery, statusFilter, autoGradedOnly])

  const filteredAssignmentTotal = filteredCourseRows.reduce(
    (sum: number, row: any) => sum + row.assignments.length,
    0
  )

  function removeAssignmentPrefix(assignment_uuid: string) {
    return assignment_uuid.replace('assignment_', '')
  }

  function removeCoursePrefix(course_uuid: string) {
    return course_uuid.replace('course_', '')
  }

  return (
    <div className='flex w-full'>
      <div className='ps-4 sm:ps-10 me-4 sm:me-10 tracking-tighter flex flex-col space-y-5 w-full'>
        <div className='flex flex-col space-y-2 pt-6'>
          <Breadcrumbs items={[
            { label: t('common.assignments'), href: '/dash/assignments', icon: <Backpack size={14} /> }
          ]} />
          <h1 className="pt-3 flex font-bold text-4xl">{t('dashboard.assignments.home.title')}</h1>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-3">
          <StatPill
            icon={<Backpack size={14} className="text-gray-500" />}
            label={t('dashboard.assignments.home.stats.total')}
            value={stats.total}
          />
          <StatPill
            icon={<CheckCircle2 size={14} className="text-emerald-500" />}
            label={t('dashboard.assignments.home.stats.published')}
            value={stats.published}
          />
          <StatPill
            icon={<EyeOff size={14} className="text-gray-500" />}
            label={t('dashboard.assignments.home.stats.drafts')}
            value={stats.drafts}
          />
          <StatPill
            icon={<Zap size={14} className="text-amber-500" />}
            label={t('dashboard.assignments.home.stats.auto_graded')}
            value={stats.auto_graded}
          />
        </div>

        {/* Toolbar */}
        <div className='flex flex-col sm:flex-row gap-3 items-stretch sm:items-center'>
          {/* Search input */}
          <div className='relative flex-1 max-w-md'>
            <Search size={14} className='absolute start-3 top-1/2 -translate-y-1/2 text-gray-400' />
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dashboard.assignments.home.search_placeholder')}
              className='w-full ps-9 pe-8 py-2 text-sm bg-white nice-shadow rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-400'
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className='absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
                aria-label='Clear search'
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Status pills */}
          <div className='flex gap-1.5'>
            <FilterPill
              label={t('dashboard.assignments.home.filters.all')}
              active={statusFilter === 'all'}
              activeClass='bg-neutral-700 text-white'
              onClick={() => setStatusFilter('all')}
            />
            <FilterPill
              label={t('dashboard.assignments.home.filters.published')}
              active={statusFilter === 'published'}
              activeClass='bg-emerald-600 text-white'
              onClick={() => setStatusFilter('published')}
            />
            <FilterPill
              label={t('dashboard.assignments.home.filters.drafts')}
              active={statusFilter === 'drafts'}
              activeClass='bg-gray-700 text-white'
              onClick={() => setStatusFilter('drafts')}
            />
          </div>

          {/* Toggles */}
          <div className='flex gap-1.5'>
            <FilterPill
              icon={<Zap size={12} />}
              label={t('dashboard.assignments.home.filters.auto_graded')}
              active={autoGradedOnly}
              activeClass='bg-amber-500 text-white'
              onClick={() => setAutoGradedOnly((v) => !v)}
            />
          </div>
        </div>

        {/* Content */}
        {!courseAssignments && (
          <div className='flex items-center justify-center py-16 text-sm text-gray-400 font-medium'>
            {t('dashboard.assignments.home.loading')}
          </div>
        )}

        {courseAssignments && filteredCourseRows.length === 0 && (
          <div className='flex flex-col items-center justify-center py-16 text-gray-400 gap-3'>
            <div className='bg-gray-100 rounded-2xl p-4'>
              <Inbox size={28} />
            </div>
            <p className='text-sm font-semibold'>
              {searchQuery || statusFilter !== 'all' || autoGradedOnly
                ? t('dashboard.assignments.home.empty_filtered')
                : t('dashboard.assignments.home.empty')}
            </p>
            {(searchQuery || statusFilter !== 'all' || autoGradedOnly) && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setStatusFilter('all')
                  setAutoGradedOnly(false)
                }}
                className='text-xs text-gray-500 hover:text-gray-700 underline'
              >
                {t('dashboard.assignments.home.clear_filters')}
              </button>
            )}
          </div>
        )}

        <div className='flex flex-col space-y-3 w-full'>
          {filteredCourseRows.map((row: any) => (
            <CourseCard
              key={row.course?.course_uuid || Math.random()}
              course={row.course}
              assignments={row.assignments}
              originalCount={row.originalCount}
              org={org}
              removeAssignmentPrefix={removeAssignmentPrefix}
              removeCoursePrefix={removeCoursePrefix}
            />
          ))}
        </div>

        {/* Filter result summary */}
        {courseAssignments && filteredCourseRows.length > 0 && (
          <p className='text-xs text-gray-400 pt-1'>
            {t('dashboard.assignments.home.showing_count', {
              shown: filteredAssignmentTotal,
              total: stats.total,
            })}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------- helper components ----------

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className='flex items-center gap-2 bg-white nice-shadow rounded-xl px-3.5 py-2'>
      {icon}
      <span className='text-[10px] uppercase tracking-wider font-semibold text-gray-400'>
        {label}
      </span>
      <span className='text-sm font-bold text-gray-900'>{value}</span>
    </div>
  )
}

function FilterPill({
  icon,
  label,
  active,
  activeClass,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
        active ? activeClass : 'bg-white nice-shadow text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function CourseCard({
  course,
  assignments,
  originalCount,
  org,
  removeAssignmentPrefix,
  removeCoursePrefix,
}: {
  course: any
  assignments: any[]
  originalCount: number
  org: any
  removeAssignmentPrefix: (uuid: string) => string
  removeCoursePrefix: (uuid: string) => string
}) {
  const { t } = useTranslation()

  if (!course) return null

  return (
    <div className='flex flex-col space-y-3'>
      {/* Course header — sits above the assignment grid as a section title.
          No outer card wrapper around the whole course because the assignments
          themselves are now the cards. */}
      <div className='flex items-center justify-between gap-3 px-1'>
        <div className='flex items-center gap-3 min-w-0'>
          <MiniThumbnail course={course} />
          <div className='flex flex-col min-w-0'>
            <span className='text-[10px] uppercase tracking-wider font-bold text-gray-400'>
              {t('dashboard.assignments.home.course_label')} · {assignments.length}
              {assignments.length !== originalCount && (
                <span className='text-gray-300'> / {originalCount}</span>
              )}
            </span>
            <p className='font-bold text-lg text-gray-900 truncate leading-tight'>
              {course.name}
            </p>
          </div>
        </div>
        <Link
          href={{
            pathname: getUriWithOrg(org.slug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`),
            query: { subpage: 'editor' },
          }}
          prefetch
          className='bg-black font-semibold text-xs text-zinc-100 rounded-lg flex space-x-1.5 nice-shadow items-center px-3 py-1.5 flex-none hover:bg-gray-800 transition-colors'
        >
          <GalleryVerticalEnd size={14} />
          <p>{t('dashboard.assignments.home.course_editor')}</p>
        </Link>
      </div>

      {/* Assignment grid — 1 column on mobile, 2 on tablet, 3 on desktop */}
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
        {assignments.map((assignment: any) => (
          <AssignmentCard
            key={assignment.assignment_uuid}
            assignment={assignment}
            org={org}
            removeAssignmentPrefix={removeAssignmentPrefix}
          />
        ))}
      </div>
    </div>
  )
}

function AssignmentCard({
  assignment,
  org,
  removeAssignmentPrefix,
}: {
  assignment: any
  org: any
  removeAssignmentPrefix: (uuid: string) => string
}) {
  const { t } = useTranslation()
  const gradingBadge = assignment.grading_type ? GRADING_TYPE_BADGE[assignment.grading_type] : null
  const editorHref = {
    pathname: getUriWithOrg(org.slug, `/dash/assignments/${removeAssignmentPrefix(assignment.assignment_uuid)}`),
    query: { subpage: 'editor' },
  }
  const submissionsHref = {
    pathname: getUriWithOrg(org.slug, `/dash/assignments/${removeAssignmentPrefix(assignment.assignment_uuid)}`),
    query: { subpage: 'submissions' },
  }

  return (
    <div className='group flex flex-col bg-white nice-shadow rounded-xl p-4 hover:bg-gray-50/40 transition-colors'>
      {/* Status indicator strip on the very top */}
      <div className='flex items-center justify-between mb-2'>
        {assignment.published ? (
          <span className='flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700'>
            <CheckCircle2 size={10} />
            {t('dashboard.assignments.detail.publishing.published')}
          </span>
        ) : (
          <span className='flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500'>
            <EyeOff size={10} />
            {t('dashboard.assignments.detail.publishing.unpublished')}
          </span>
        )}
        {assignment.due_date && (
          <span className='flex items-center gap-1 text-[10px] font-medium text-gray-500'>
            <Calendar size={11} />
            <span>{assignment.due_date}</span>
          </span>
        )}
      </div>

      {/* Title */}
      <Link
        href={editorHref}
        prefetch
        className='block text-base font-bold text-gray-900 leading-tight hover:text-black mb-1 line-clamp-2 break-words'
      >
        {assignment.title || t('dashboard.assignments.home.untitled')}
      </Link>

      {/* Description — fixed min-height so cards align even when one has no description */}
      <p className='text-xs text-gray-500 line-clamp-2 min-h-[2rem] mb-3 break-words'>
        {assignment.description || ''}
      </p>

      {/* Badges row */}
      <div className='flex items-center gap-1.5 flex-wrap mb-3'>
        {gradingBadge && (
          <span className={`${BADGE_BASE} ${gradingBadge.color}`}>
            {gradingBadge.icon}
            <span>{t(gradingBadge.labelKey)}</span>
          </span>
        )}
        {assignment.auto_grading && (
          <span className={`${BADGE_BASE} ${BADGE_AMBER}`}>
            <Zap size={13} />
            <span>{t('dashboard.assignments.detail.header_badges.auto_grading')}</span>
          </span>
        )}
        {assignment.anti_copy_paste && (
          <span className={`${BADGE_BASE} ${BADGE_CYAN}`}>
            <Shield size={13} />
            <span>{t('dashboard.assignments.detail.header_badges.anti_copy_paste')}</span>
          </span>
        )}
      </div>

      {/* Footer actions — pinned to the bottom of the card. Restored to the
          classic white pill-with-nice-shadow look. */}
      <div className='flex items-center gap-2 mt-auto pt-3 border-t border-gray-100'>
        <Link
          href={editorHref}
          prefetch
          className='bg-white rounded-full flex space-x-1.5 nice-shadow items-center px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors'
        >
          <Layers2 size={13} />
          <p>{t('dashboard.assignments.home.editor')}</p>
        </Link>
        <Link
          href={submissionsHref}
          prefetch
          className='bg-white rounded-full flex space-x-1.5 nice-shadow items-center px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors'
        >
          <UserRoundPen size={13} />
          <p>{t('dashboard.assignments.home.submissions')}</p>
        </Link>
      </div>
    </div>
  )
}

const MiniThumbnail = (props: { course: any }) => {
  const org = useOrg() as any

  function removeCoursePrefix(course_uuid: string) {
    return course_uuid.replace('course_', '')
  }

  return (
    <Link
      href={getUriWithOrg(
        org.orgslug,
        '/course/' + removeCoursePrefix(props.course.course_uuid)
      )}
    >
      {props.course.thumbnail_image ? (
        <div
          className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-[70px] h-[40px] bg-cover flex-none"
          style={{
            backgroundImage: `url(${getCourseThumbnailMediaDirectory(
              org?.org_uuid,
              props.course.course_uuid,
              props.course.thumbnail_image
            )})`,
          }}
        />
      ) : (
        <div
          className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-[70px] h-[40px] bg-cover flex-none"
          style={{
            backgroundImage: `url('/empty_thumbnail.png')`,
            backgroundSize: 'contain',
          }}
        />
      )}
    </Link>
  )
}


export default AssignmentsHome
