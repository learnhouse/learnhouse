'use client';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config';
import { getAssignmentsFromACourse } from '@services/courses/assignments';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { getOrgCourses } from '@services/courses/courses';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  Backpack,
  Calendar,
  CheckCircle2,
  ChevronDown,
  EyeOff,
  Inbox,
  Layers2,
  Plus,
  Search,
  Shield,
  UserRoundPen,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next';
import NewAssignmentModal from './_components/NewAssignmentModal';
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  BTN_PRIMARY,
  BTN_SECONDARY_SM,
  Chip,
  formatShortDate,
  gradingMetaFor,
  isPastDate,
} from './_components/assignmentUi';

type StatusFilter = 'all' | 'published' | 'drafts';

// Desktop table layout. The card is the grid; the header row, the list and
// each row are subgrids spanning it, so every column (including the auto-sized
// actions column) lines up across rows.
const TABLE_GRID =
  'xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] xl:gap-x-4'
const ROW_GRID = 'xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-center xl:gap-x-4'

function AssignmentsHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any;
  const queryClient = useQueryClient();
  const [showNewAssignment, setShowNewAssignment] = useState(false);

  const invalidateAssignments = () => {
    queryClient.invalidateQueries({ queryKey: ['assignments-all'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(org?.slug ?? '') });
  };

  const { data: courses } = useQuery({
    queryKey: queryKeys.courses.list(org?.slug ?? ''),
    queryFn: () => getOrgCourses(org.slug, {}, access_token, true),
    enabled: !!(org?.slug && access_token),
    staleTime: 60_000,
  })

  // Fetch all course assignments in a single query call to avoid N+1 requests
  const courseUuids = useMemo(() => courses?.map((c: any) => c.course_uuid) || [], [courses])
  const { data: courseAssignments } = useQuery({
    queryKey: ['assignments-all', ...courseUuids],
    queryFn: async () => {
      // allSettled, not all: a single rejected request (network blip, one bad
      // course) used to take the whole dashboard down with it.
      const settled = await Promise.allSettled(
        courseUuids.map((uuid: string) => getAssignmentsFromACourse(uuid, access_token))
      )
      // The response helper does not throw; a 404 resolves to
      // `{ success: false, data: { detail: 'Course not found' } }`. That object
      // is truthy, so the downstream `|| []` guards never fired and the error
      // body reached `.filter(...)` during render, blanking the page (no error
      // boundary under this segment) and counting as a phantom draft in the
      // stats. Anything that isn't a real array collapses to an empty list;
      // note we map rather than filter so the result stays index-aligned with
      // `courseUuids` / `courses`, otherwise a single failing course would
      // shift every later course's assignments onto the wrong course.
      return settled.map((r: any) =>
        r.status === 'fulfilled' && r.value?.success && Array.isArray(r.value.data)
          ? r.value.data
          : []
      )
    },
    enabled: courseUuids.length > 0 && !!access_token,
    staleTime: 60_000,
  })

  // === Filter / search state ===
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [autoGradedOnly, setAutoGradedOnly] = useState(false)
  const [courseFilter, setCourseFilter] = useState<string>('all')

  // === Stats (computed from the unfiltered data) ===
  const stats = useMemo(() => {
    const allAssignments: any[] = (courseAssignments || []).flat()
    return {
      total: allAssignments.length,
      published: allAssignments.filter((a: any) => a.published).length,
      drafts: allAssignments.filter((a: any) => !a.published).length,
      auto_graded: allAssignments.filter((a: any) => a.auto_grading).length,
    }
  }, [courseAssignments])

  // Every assignment paired with its course, in course order. Courses with no
  // assignments simply contribute nothing.
  const allRows = useMemo(() => {
    if (!courseAssignments || !courses) return []
    return courseAssignments.flatMap((assignments: any[], index: number) =>
      (assignments || []).map((assignment: any) => ({ assignment, course: courses[index] }))
    ).filter((r: any) => !!r.course)
  }, [courseAssignments, courses])

  // Only courses that actually hold assignments are worth offering as a filter.
  const coursesWithAssignments = useMemo(() => {
    const seen = new Map<string, any>()
    allRows.forEach((r: any) => { if (!seen.has(r.course.course_uuid)) seen.set(r.course.course_uuid, r.course) })
    return Array.from(seen.values())
  }, [allRows])

  // === Filtering ===
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allRows.filter(({ assignment, course }: any) => {
      // Search by title or description (case-insensitive)
      if (q) {
        const title = (assignment.title || '').toLowerCase()
        const desc = (assignment.description || '').toLowerCase()
        if (!title.includes(q) && !desc.includes(q)) return false
      }
      if (statusFilter === 'published' && !assignment.published) return false
      if (statusFilter === 'drafts' && assignment.published) return false
      if (autoGradedOnly && !assignment.auto_grading) return false
      if (courseFilter !== 'all' && course.course_uuid !== courseFilter) return false
      return true
    })
  }, [allRows, searchQuery, statusFilter, autoGradedOnly, courseFilter])

  const hasActiveFilters = !!searchQuery || statusFilter !== 'all' || autoGradedOnly || courseFilter !== 'all'
  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setAutoGradedOnly(false)
    setCourseFilter('all')
  }

  const statusOptions: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('dashboard.assignments.home.filters.all') },
    { key: 'published', label: t('dashboard.assignments.home.filters.published') },
    { key: 'drafts', label: t('dashboard.assignments.home.filters.drafts') },
  ]

  return (
    <div className='flex w-full'>
      <div className='px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0'>
        {/* Header */}
        <div className='flex flex-col gap-4 pt-4 sm:pt-6'>
          <Breadcrumbs items={[
            { label: t('common.assignments'), href: '/dash/assignments', icon: <Backpack size={14} /> }
          ]} />
          <div className='flex flex-wrap items-end justify-between gap-x-4 gap-y-3'>
            <div className='min-w-0'>
              <h1 className='text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900'>{t('dashboard.assignments.home.title')}</h1>
              <p className='mt-1 text-sm text-neutral-500'>
                {t('dashboard.assignments.home.subtitle')}
              </p>
            </div>
            <button onClick={() => setShowNewAssignment(true)} className={BTN_PRIMARY}>
              <Plus size={16} />
              {t('dashboard.assignments.home.new_assignment', { defaultValue: 'New Assignment' })}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
          <StatCard
            icon={<Backpack size={16} />}
            iconClass='bg-neutral-100 text-neutral-600'
            label={t('dashboard.assignments.home.stats.total')}
            value={courseAssignments ? stats.total : null}
          />
          <StatCard
            icon={<CheckCircle2 size={16} />}
            iconClass='bg-emerald-50 text-emerald-600'
            label={t('dashboard.assignments.home.stats.published')}
            value={courseAssignments ? stats.published : null}
          />
          <StatCard
            icon={<EyeOff size={16} />}
            iconClass='bg-neutral-100 text-neutral-600'
            label={t('dashboard.assignments.home.stats.drafts')}
            value={courseAssignments ? stats.drafts : null}
          />
          <StatCard
            icon={<Zap size={16} />}
            iconClass='bg-amber-50 text-amber-600'
            label={t('dashboard.assignments.home.stats.auto_graded')}
            value={courseAssignments ? stats.auto_graded : null}
          />
        </div>

        {/* Toolbar */}
        <div className='flex flex-col xl:flex-row gap-3 xl:items-center'>
          <div className='relative flex-1 min-w-0 xl:max-w-md'>
            <Search size={16} className='absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400' />
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dashboard.assignments.home.search_placeholder')}
              className='w-full h-10 ps-10 pe-9 text-sm bg-white nice-shadow rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/10 placeholder:text-neutral-400'
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className='absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600'
                aria-label={t('dashboard.assignments.home.clear_search')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {/* Status segmented control */}
            <div className='inline-flex items-center rounded-xl bg-neutral-200/60 p-1' role='tablist'>
              {statusOptions.map((opt) => (
                <button
                  key={opt.key}
                  role='tab'
                  aria-selected={statusFilter === opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    statusFilter === opt.key ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Auto-graded toggle */}
            <button
              onClick={() => setAutoGradedOnly((v) => !v)}
              aria-pressed={autoGradedOnly}
              className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                autoGradedOnly ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200' : 'bg-white nice-shadow text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Zap size={14} />
              {t('dashboard.assignments.home.filters.auto_graded')}
            </button>

            {/* Course filter */}
            {coursesWithAssignments.length > 1 && (
              <div className='relative min-w-0'>
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                  aria-label={t('dashboard.assignments.home.course_label')}
                  className='appearance-none h-10 ps-3 pe-8 max-w-[220px] truncate rounded-xl bg-white nice-shadow text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 cursor-pointer'
                >
                  <option value='all'>{t('common.all_courses')}</option>
                  {coursesWithAssignments.map((c: any) => (
                    <option key={c.course_uuid} value={c.course_uuid}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className='pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400' />
              </div>
            )}
          </div>
        </div>

        {/* List */}
        <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
          {/* Column labels (desktop) */}
          <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
            <span>{t('dashboard.assignments.home.assignment_label')}</span>
            <span>{t('dashboard.assignments.home.course_label')}</span>
            <span>{t('dashboard.assignments.home.columns.grading')}</span>
            <span>{t('assignments.due_date')}</span>
            <span>{t('common.status')}</span>
            <span className='sr-only'>{t('dashboard.assignments.home.columns.actions')}</span>
          </div>

          {!courseAssignments && (
            <div className='animate-pulse divide-y divide-neutral-100 xl:col-span-full'>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className='flex items-center gap-3 px-5 py-4'>
                  <div className='w-10 h-10 rounded-xl bg-neutral-100 shrink-0' />
                  <div className='flex-1 space-y-2'>
                    <div className='h-3.5 bg-neutral-100 rounded w-1/3' />
                    <div className='h-3 bg-neutral-100 rounded w-1/2' />
                  </div>
                  <div className='hidden sm:block h-6 w-20 bg-neutral-100 rounded-full' />
                </div>
              ))}
            </div>
          )}

          {courseAssignments && filteredRows.length === 0 && (
            <div className='flex flex-col items-center justify-center text-center py-16 px-6 gap-3 xl:col-span-full'>
              <div className='w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center'>
                <Inbox size={22} />
              </div>
              <div>
                <p className='text-base font-semibold text-neutral-900'>
                  {hasActiveFilters
                    ? t('dashboard.assignments.home.empty_filtered')
                    : t('dashboard.assignments.home.empty')}
                </p>
                {!hasActiveFilters && (
                  <p className='mt-1 text-sm text-neutral-500 max-w-sm'>{t('dashboard.assignments.home.empty_description')}</p>
                )}
              </div>
              {hasActiveFilters ? (
                <button onClick={clearFilters} className={BTN_SECONDARY_SM}>
                  {t('dashboard.assignments.home.clear_filters')}
                </button>
              ) : (
                <button onClick={() => setShowNewAssignment(true)} className={`${BTN_PRIMARY} mt-1`}>
                  <Plus size={16} />
                  {t('dashboard.assignments.home.new_assignment', { defaultValue: 'New Assignment' })}
                </button>
              )}
            </div>
          )}

          {filteredRows.length > 0 && (
            <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
              {filteredRows.map(({ assignment, course }: any) => (
                <AssignmentRow
                  key={assignment.assignment_uuid}
                  assignment={assignment}
                  course={course}
                  org={org}
                />
              ))}
            </ul>
          )}

          {courseAssignments && filteredRows.length > 0 && (
            <div className='px-5 py-3 border-t border-neutral-100 text-xs text-neutral-500 tabular-nums xl:col-span-full'>
              {t('dashboard.assignments.home.showing_count', {
                shown: filteredRows.length,
                total: stats.total,
              })}
            </div>
          )}
        </div>
      </div>

      <NewAssignmentModal
        open={showNewAssignment}
        onClose={() => setShowNewAssignment(false)}
        courses={courses}
        org={org}
        onCreated={invalidateAssignments}
      />
    </div>
  )
}

// ---------- helper components ----------

function StatCard({
  icon,
  iconClass,
  label,
  value,
}: {
  icon: React.ReactNode
  iconClass: string
  label: string
  value: number | null
}) {
  return (
    <div className='flex items-center gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5 min-w-0'>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>{icon}</div>
      <div className='min-w-0'>
        <p className='text-xs text-neutral-500 truncate'>{label}</p>
        {value === null ? (
          <div className='mt-1 h-5 w-8 rounded bg-neutral-100 animate-pulse' />
        ) : (
          <p className='text-xl font-bold text-neutral-900 tabular-nums leading-tight'>{value}</p>
        )}
      </div>
    </div>
  )
}

function removeAssignmentPrefix(assignment_uuid: string) {
  return assignment_uuid.replace('assignment_', '')
}

function removeCoursePrefix(course_uuid: string) {
  return course_uuid.replace('course_', '')
}

function AssignmentRow({
  assignment,
  course,
  org,
}: {
  assignment: any
  course: any
  org: any
}) {
  const { t, i18n } = useTranslation()
  const grading = gradingMetaFor(assignment)
  const GradingIcon = grading?.Icon
  const dueDate = formatShortDate(assignment.due_date, i18n.language)
  const isPastDue = isPastDate(assignment.due_date)
  const base = `/dash/assignments/${removeAssignmentPrefix(assignment.assignment_uuid)}`
  const editorHref = { pathname: getUriWithOrg(org.slug, base), query: { subpage: 'editor' } }
  const submissionsHref = { pathname: getUriWithOrg(org.slug, base), query: { subpage: 'submissions' } }
  const courseEditorHref = {
    pathname: getUriWithOrg(org.slug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`),
    query: { subpage: 'editor' },
  }

  const statusChip = assignment.published ? (
    <Chip tone='emerald' icon={<CheckCircle2 size={12} />}>{t('dashboard.assignments.detail.publishing.published')}</Chip>
  ) : (
    <Chip tone='neutral' icon={<EyeOff size={12} />}>{t('dashboard.assignments.home.status_draft')}</Chip>
  )

  return (
    <li className={`group relative px-4 sm:px-5 py-4 hover:bg-neutral-50/70 transition-colors ${ROW_GRID}`}>
      {/* Title */}
      <div className='flex items-start gap-3 min-w-0'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-start justify-between gap-2'>
            <Link
              href={editorHref}
              prefetch
              className='text-sm font-semibold text-neutral-900 leading-snug hover:underline underline-offset-2 line-clamp-2 break-words'
            >
              {assignment.title || t('dashboard.assignments.home.untitled')}
            </Link>
            <span className='xl:hidden shrink-0'>{statusChip}</span>
          </div>
          {assignment.description && (
            <p className='mt-0.5 text-xs text-neutral-500 line-clamp-1 break-words'>{assignment.description}</p>
          )}
          {/* Compact meta line (below lg the columns collapse into this) */}
          <div className='xl:hidden mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500'>
            <span className='inline-flex items-center gap-1 min-w-0 max-w-full'>
              <Layers2 size={12} className='shrink-0' />
              <span className='truncate'>{course.name}</span>
            </span>
            {grading && GradingIcon && (
              <span className='inline-flex items-center gap-1'>
                <GradingIcon size={12} />
                {t(grading.labelKey)}
              </span>
            )}
            {dueDate && (
              <span className={`inline-flex items-center gap-1 tabular-nums ${isPastDue ? 'text-rose-600' : ''}`}>
                <Calendar size={12} />
                {dueDate}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Course */}
      <Link
        href={courseEditorHref}
        prefetch
        title={t('dashboard.assignments.home.course_editor')}
        className='hidden xl:flex items-center gap-2.5 min-w-0 text-sm text-neutral-700 hover:text-neutral-900'
      >
        <ThumbnailImage
          src={
            course.thumbnail_image
              ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
              : null
          }
          className='w-10 h-6 rounded-md ring-1 ring-black/5 flex-none'
        />
        <span className='truncate hover:underline underline-offset-2'>{course.name}</span>
      </Link>

      {/* Grading */}
      <div className='hidden xl:flex items-center gap-1.5 min-w-0 text-sm text-neutral-700'>
        {grading && GradingIcon && (
          <span className='inline-flex items-center gap-1.5 min-w-0'>
            <GradingIcon size={14} className='text-neutral-400 shrink-0' />
            <span className='truncate'>{t(grading.labelKey)}</span>
          </span>
        )}
        {assignment.auto_grading && (
          <span title={t('dashboard.assignments.detail.header_badges.auto_grading')} className='text-amber-500'>
            <Zap size={14} />
          </span>
        )}
        {assignment.anti_copy_paste && (
          <span title={t('dashboard.assignments.detail.header_badges.anti_copy_paste')} className='text-sky-500'>
            <Shield size={14} />
          </span>
        )}
      </div>

      {/* Due date */}
      <div className={`hidden xl:block text-sm tabular-nums ${dueDate ? (isPastDue ? 'text-rose-600' : 'text-neutral-700') : 'text-neutral-400'}`}>
        {dueDate ?? t('dashboard.assignments.home.no_due_date')}
      </div>

      {/* Status */}
      <div className='hidden xl:block'>{statusChip}</div>

      {/* Actions */}
      <div className='mt-3 xl:mt-0 flex items-center gap-2 xl:justify-end'>
        <Link href={editorHref} prefetch className={`${BTN_SECONDARY_SM} flex-1 xl:flex-none`}>
          <Layers2 size={14} />
          {t('dashboard.assignments.home.editor')}
        </Link>
        <Link href={submissionsHref} prefetch className={`${BTN_SECONDARY_SM} flex-1 xl:flex-none`}>
          <UserRoundPen size={14} />
          {t('dashboard.assignments.home.submissions')}
        </Link>
      </div>
    </li>
  )
}

export default AssignmentsHome
