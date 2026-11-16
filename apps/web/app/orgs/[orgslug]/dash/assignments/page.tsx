'use client';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { updateAssignment } from '@services/courses/assignments';
import { updateActivity } from '@services/courses/activities';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { apiFetch } from '@services/utils/ts/requests';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { courseAssignmentsQuery, dashCoursesQuery } from '@/lib/query/dashQueries';
import {
  ArrowsDownUp,
  Backpack,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  ClipboardText,
  EyeSlash,
  Lightning,
  Link as LinkIcon,
  ListChecks,
  PencilSimple,
  Plus,
  ShieldCheck,
  StackSimple,
  Tray,
  UserCheck,
  WarningCircle,
  Clock,
} from '@phosphor-icons/react'
import Link from 'next/link';
import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Switch } from '@components/ui/switch';
import NewAssignmentModal from './_components/NewAssignmentModal';
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import {
  Button,
  DashPageHeader,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ToolbarSelect,
  buttonClass,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { Chip, dueStateOf, formatShortDate, gradingMetaFor } from './_components/assignmentUi';
import { assignmentLearnerPath, copyAssignmentLink } from './_components/assignmentLinks';
import { fetchAllAssignmentSubmissions } from './[assignmentuuid]/subpages/AssignmentSubmissionsSubPage';
import SubmissionsPanel, { type SubmissionCounts, countsFromSubmissions } from './_components/SubmissionsPanel';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';

type StatusFilter = 'all' | 'published' | 'drafts';
type SortKey = 'course' | 'needs_grading' | 'due' | 'title';
const SORT_KEYS: readonly SortKey[] = ['course', 'needs_grading', 'due', 'title'];

// Desktop table layout. The card is the grid; the header row, the list and
// each row are subgrids spanning it, so every column (including the auto-sized
// actions column) lines up across rows.
const TABLE_GRID =
  'xl:grid xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:gap-x-4'
const ROW_GRID = 'xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-center xl:gap-x-4'

const shortAssignmentUuid = (uuid: string) => uuid.replace('assignment_', '')
const shortCourseUuid = (uuid: string) => uuid.replace('course_', '')

// What the API told us about an assignment's submissions. Older API builds
// don't send `submission_counts`; the row then shows counts once the teacher
// opens its submissions.
function apiCounts(assignment: any): SubmissionCounts | null {
  const c = assignment?.submission_counts
  if (!c || typeof c !== 'object') return null
  return {
    total: Number(c.total) || 0,
    to_grade: Number(c.to_grade) || 0,
    graded: Number(c.graded) || 0,
    late: Number(c.late) || 0,
  }
}

// Index-aligned with `courses`; undefined until every course answered. Kept
// at module level so React Query can memoize the combined result.
function combineCourseAssignments(results: { data?: any[] }[]) {
  return results.every((r) => r.data !== undefined) ? results.map((r) => r.data as any[]) : undefined
}

function AssignmentsHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const org = useOrg() as any;
  const queryClient = useQueryClient();
  const { track } = useLHAnalytics('dashboard');
  const [showNewAssignment, setShowNewAssignment] = useState(false);
  // Only one row's submissions are open at a time, so the page never holds
  // more than one submissions list (and its user lookups) in flight.
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null);

  const invalidateAssignments = () => {
    queryClient.invalidateQueries({ queryKey: ['assignments-all'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(org?.slug ?? '') });
  };

  const { data: courses } = useQuery({
    ...dashCoursesQuery(org?.slug ?? '', access_token),
    enabled: !!(org?.slug && access_token),
  })

  // One request per course (there is no org-wide assignments endpoint), all
  // fired together. Each response already carries per-assignment submission
  // counts for instructors, so the list never fetches submissions per row.
  // One cache entry per course, shared with the sidebar's assignments menu
  // and its hover prefetch, so whichever asks first serves the other. A
  // failed course resolves to [] (see courseAssignmentsQuery) rather than
  // taking the whole list down.
  const courseUuids = useMemo(() => (Array.isArray(courses) ? courses.map((c: any) => c.course_uuid) : []), [courses])
  const courseAssignments = useQueries({
    queries: courseUuids.map((uuid: string) => ({
      ...courseAssignmentsQuery(uuid, access_token),
      enabled: !!access_token,
    })),
    combine: combineCourseAssignments,
  })
  // An org without courses never runs the queries above; treat it as loaded.
  const loaded = (!!courseAssignments && courseUuids.length > 0) || (Array.isArray(courses) && courses.length === 0)

  // === Filter / search / sort state ===
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [autoGradedOnly, setAutoGradedOnly] = useState(false)
  const [needsGradingOnly, setNeedsGradingOnly] = useState(false)
  const [courseFilter, setCourseFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useStoredState<SortKey>('lh.dash.assignments.sort', 'course', SORT_KEYS)

  // Every assignment paired with its course, in course order.
  const allRows = useMemo(() => {
    if (!Array.isArray(courseAssignments) || !Array.isArray(courses)) return []
    return courseAssignments.flatMap((assignments: any[], index: number) =>
      (Array.isArray(assignments) ? assignments : []).map((assignment: any) => ({
        assignment,
        course: courses[index],
        counts: apiCounts(assignment),
      }))
    ).filter((r: any) => !!r.course)
  }, [courseAssignments, courses])

  // === Stats (computed from the unfiltered data) ===
  const stats = useMemo(() => {
    const all = allRows.map((r) => r.assignment)
    const withCounts = allRows.filter((r) => r.counts)
    return {
      total: all.length,
      published: all.filter((a: any) => a.published).length,
      drafts: all.filter((a: any) => !a.published).length,
      auto_graded: all.filter((a: any) => a.auto_grading).length,
      // null = this API build doesn't report counts; shown as a dash.
      to_grade: withCounts.length || all.length === 0
        ? withCounts.reduce((sum, r) => sum + (r.counts?.to_grade ?? 0), 0)
        : null,
    }
  }, [allRows])

  // Only courses that actually hold assignments are worth offering as a filter.
  const coursesWithAssignments = useMemo(() => {
    const seen = new Map<string, any>()
    allRows.forEach((r: any) => { if (!seen.has(r.course.course_uuid)) seen.set(r.course.course_uuid, r.course) })
    return Array.from(seen.values())
  }, [allRows])

  // === Filtering + sorting ===
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const rows = allRows.filter(({ assignment, course, counts }: any) => {
      if (q) {
        const title = (assignment.title || '').toLowerCase()
        const desc = (assignment.description || '').toLowerCase()
        if (!title.includes(q) && !desc.includes(q)) return false
      }
      if (statusFilter === 'published' && !assignment.published) return false
      if (statusFilter === 'drafts' && assignment.published) return false
      if (autoGradedOnly && !assignment.auto_grading) return false
      if (needsGradingOnly && !(counts?.to_grade > 0)) return false
      if (courseFilter !== 'all' && course.course_uuid !== courseFilter) return false
      return true
    })
    if (sortKey === 'course') return rows
    const dueMs = (a: any) => {
      const time = a.due_date ? new Date(a.due_date).getTime() : NaN
      return isNaN(time) ? Number.POSITIVE_INFINITY : time
    }
    return [...rows].sort((x: any, y: any) => {
      if (sortKey === 'needs_grading') {
        const diff = (y.counts?.to_grade ?? -1) - (x.counts?.to_grade ?? -1)
        if (diff !== 0) return diff
        return dueMs(x.assignment) - dueMs(y.assignment)
      }
      if (sortKey === 'due') return dueMs(x.assignment) - dueMs(y.assignment)
      return (x.assignment.title || '').localeCompare(y.assignment.title || '', undefined, { sensitivity: 'base' })
    })
  }, [allRows, searchQuery, statusFilter, autoGradedOnly, needsGradingOnly, courseFilter, sortKey])

  const hasActiveFilters = !!searchQuery || statusFilter !== 'all' || autoGradedOnly || needsGradingOnly || courseFilter !== 'all'
  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setAutoGradedOnly(false)
    setNeedsGradingOnly(false)
    setCourseFilter('all')
  }

  // The listing gives us the parent activity's uuid; older API builds don't,
  // so fall back to the single read (which always has it).
  const resolveActivityUuid = async (assignment: any): Promise<string | null> => {
    if (assignment.activity_uuid) return assignment.activity_uuid
    try {
      const detail = await apiFetch(`${getAPIUrl()}assignments/${assignment.assignment_uuid}`, access_token)
      return detail?.activity_uuid ?? null
    } catch {
      return null
    }
  }

  // Quick publish from the row. Optimistic: the switch flips immediately and
  // the list is refetched if either leg fails, so it never lies for long.
  // Mirrors the detail page: the assignment and its activity move together,
  // otherwise learners still can't open a "published" assignment.
  const togglePublished = async (assignment: any) => {
    const next = !assignment.published
    const uuid = assignment.assignment_uuid
    const course = allRows.find((r: any) => r.assignment.assignment_uuid === uuid)?.course
    if (course) {
      queryClient.setQueryData(queryKeys.assignments.byCourse(course.course_uuid), (old: any) =>
        Array.isArray(old) ? old.map((a: any) => (a.assignment_uuid === uuid ? { ...a, published: next } : a)) : old
      )
    }
    try {
      const res = await updateAssignment({ published: next }, uuid, access_token)
      const activityUuid = res.success ? await resolveActivityUuid(assignment) : null
      const res2 = activityUuid ? await updateActivity({ published: next }, activityUuid, access_token) : { success: false }
      if (!res.success || !res2.success) throw new Error('publish failed')
      toast.success(
        next
          ? t('dashboard.assignments.list.toasts.published')
          : t('dashboard.assignments.list.toasts.unpublished')
      )
      track(AnalyticsEvent.AssignmentPublishToggled, { published: next, task_count: 0 })
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(uuid) })
    } catch {
      toast.error(t('dashboard.assignments.detail.publishing.toasts.update_error'))
      queryClient.invalidateQueries({ queryKey: ['assignments-all'] })
    }
  }

  const copyLink = async (assignment: any, course: any) => {
    const path = assignmentLearnerPath(course?.course_uuid, await resolveActivityUuid(assignment))
    if (!path) {
      toast.error(t('dashboard.assignments.list.link_copy_failed'))
      return
    }
    await copyAssignmentLink(path, t)
  }

  const statusOptions: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'all', label: t('dashboard.assignments.home.filters.all'), count: loaded ? stats.total : undefined },
    { key: 'published', label: t('dashboard.assignments.home.filters.published'), count: loaded ? stats.published : undefined },
    { key: 'drafts', label: t('dashboard.assignments.home.filters.drafts'), count: loaded ? stats.drafts : undefined },
  ]
  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'course', label: t('dashboard.assignments.list.sort.course') },
    { value: 'needs_grading', label: t('dashboard.assignments.list.sort.needs_grading') },
    { value: 'due', label: t('dashboard.assignments.list.sort.due') },
    { value: 'title', label: t('dashboard.assignments.list.sort.title') },
  ]
  const isEmptyOrg = loaded && stats.total === 0

  return (
    <div className='flex w-full'>
      <div className='px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0'>
        <DashPageHeader
          breadcrumbs={[{ label: t('common.assignments'), href: '/dash/assignments', icon: <Backpack size={14} /> }]}
          title={t('dashboard.assignments.home.title')}
          subtitle={t('dashboard.assignments.home.subtitle')}
          actions={
            <Button variant='primary' icon={<Plus size={14} weight='bold' />} onClick={() => setShowNewAssignment(true)}>
              {t('dashboard.assignments.home.new_assignment', { defaultValue: 'New Assignment' })}
            </Button>
          }
        />

        {!isEmptyOrg && (
          <>
            {/* Stats: each one is also a filter */}
            <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
              <StatCard
                icon={<UserCheck size={16} />}
                iconClass='bg-amber-50 text-amber-600'
                label={t('dashboard.assignments.list.stats.needs_grading')}
                value={!loaded ? null : stats.to_grade === null ? '—' : stats.to_grade}
                active={needsGradingOnly}
                // Without counts from the API there is nothing to filter on.
                onClick={stats.to_grade === null ? undefined : () => {
                  const next = !needsGradingOnly
                  setNeedsGradingOnly(next)
                  if (next) setSortKey('needs_grading')
                }}
              />
              <StatCard
                icon={<CheckCircle size={16} />}
                iconClass='bg-emerald-50 text-emerald-600'
                label={t('dashboard.assignments.home.stats.published')}
                value={loaded ? stats.published : null}
                active={statusFilter === 'published'}
                onClick={() => setStatusFilter(statusFilter === 'published' ? 'all' : 'published')}
              />
              <StatCard
                icon={<EyeSlash size={16} />}
                iconClass='bg-neutral-100 text-neutral-600'
                label={t('dashboard.assignments.home.stats.drafts')}
                value={loaded ? stats.drafts : null}
                active={statusFilter === 'drafts'}
                onClick={() => setStatusFilter(statusFilter === 'drafts' ? 'all' : 'drafts')}
              />
              <StatCard
                icon={<Lightning size={16} />}
                iconClass='bg-violet-50 text-violet-600'
                label={t('dashboard.assignments.home.stats.auto_graded')}
                value={loaded ? stats.auto_graded : null}
                active={autoGradedOnly}
                onClick={() => setAutoGradedOnly((v) => !v)}
              />
            </div>

            {/* Toolbar */}
            <div className='flex flex-col lg:flex-row gap-3 lg:items-center'>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('dashboard.assignments.home.search_placeholder')}
                className='lg:max-w-xs lg:min-w-[220px]'
              />
              <div className='flex flex-wrap items-center gap-2 min-w-0 lg:ms-auto'>
                <SegmentedControl
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={statusOptions}
                  ariaLabel={t('common.status')}
                />
                {coursesWithAssignments.length > 1 && (
                  <ToolbarSelect
                    value={courseFilter}
                    onChange={setCourseFilter}
                    ariaLabel={t('dashboard.assignments.home.course_label')}
                    icon={<StackSimple size={14} />}
                    options={[
                      { value: 'all', label: t('common.all_courses') },
                      ...coursesWithAssignments.map((c: any) => ({ value: c.course_uuid, label: c.name })),
                    ]}
                  />
                )}
                <ToolbarSelect
                  value={sortKey}
                  onChange={(v) => setSortKey(v as SortKey)}
                  ariaLabel={t('dashboard.assignments.list.sort.label')}
                  icon={<ArrowsDownUp size={14} />}
                  options={sortOptions}
                />
              </div>
            </div>
          </>
        )}

        {/* List */}
        {isEmptyOrg ? (
          <AssignmentsIntro onCreate={() => setShowNewAssignment(true)} />
        ) : (
          <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
            {/* Column labels (desktop) */}
            <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('dashboard.assignments.home.assignment_label')}</span>
              <span>{t('dashboard.assignments.home.course_label')}</span>
              <span>{t('dashboard.assignments.home.submissions')}</span>
              <span>{t('assignments.due_date')}</span>
              <span>{t('common.status')}</span>
              <span className='sr-only'>{t('dashboard.assignments.home.columns.actions')}</span>
            </div>

            {!loaded && (
              <div className='animate-pulse divide-y divide-neutral-100 xl:col-span-full'>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className='flex items-center gap-3 px-5 py-4'>
                    <div className='flex-1 space-y-2'>
                      <div className='h-3.5 bg-neutral-100 rounded w-1/3' />
                      <div className='h-3 bg-neutral-100 rounded w-1/2' />
                    </div>
                    <div className='hidden sm:block h-6 w-20 bg-neutral-100 rounded-full' />
                    <div className='hidden sm:block h-7 w-24 bg-neutral-100 rounded-lg' />
                  </div>
                ))}
              </div>
            )}

            {loaded && filteredRows.length === 0 && (
              <div className='xl:col-span-full'>
                <EmptyState
                  icon={<Tray size={22} />}
                  title={t('dashboard.assignments.home.empty_filtered')}
                  action={
                    <Button size='sm' onClick={clearFilters}>
                      {t('dashboard.assignments.home.clear_filters')}
                    </Button>
                  }
                />
              </div>
            )}

            {filteredRows.length > 0 && (
              <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
                {filteredRows.map(({ assignment, course, counts }: any) => (
                  <AssignmentRow
                    key={assignment.assignment_uuid}
                    assignment={assignment}
                    course={course}
                    apiCounts={counts}
                    org={org}
                    expanded={expandedUuid === assignment.assignment_uuid}
                    onToggleExpanded={() =>
                      setExpandedUuid((cur) => (cur === assignment.assignment_uuid ? null : assignment.assignment_uuid))
                    }
                    onTogglePublished={() => togglePublished(assignment)}
                    onCopyLink={() => copyLink(assignment, course)}
                  />
                ))}
              </ul>
            )}

            {loaded && filteredRows.length > 0 && (
              <div className='px-5 py-3 border-t border-neutral-100 text-xs text-neutral-500 tabular-nums xl:col-span-full'>
                {t('dashboard.assignments.home.showing_count', {
                  shown: filteredRows.length,
                  total: stats.total,
                })}
              </div>
            )}
          </div>
        )}
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

// First-run state: what an assignment is and how the flow goes, so the page
// teaches instead of just saying "nothing here".
function AssignmentsIntro({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  const steps = [
    { Icon: StackSimple, title: t('dashboard.assignments.list.intro.step1_title'), text: t('dashboard.assignments.list.intro.step1_text') },
    { Icon: ListChecks, title: t('dashboard.assignments.list.intro.step2_title'), text: t('dashboard.assignments.list.intro.step2_text') },
    { Icon: UserCheck, title: t('dashboard.assignments.list.intro.step3_title'), text: t('dashboard.assignments.list.intro.step3_text') },
  ]
  return (
    <div className='bg-white rounded-2xl nice-shadow px-6 py-12 flex flex-col items-center text-center gap-6'>
      <div className='flex flex-col items-center gap-3'>
        <div className='w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center'>
          <Backpack size={22} />
        </div>
        <div>
          <p className='text-base font-semibold text-neutral-900'>{t('dashboard.assignments.home.empty')}</p>
          <p className='mt-1 text-sm text-neutral-500'>{t('dashboard.assignments.list.intro.description')}</p>
        </div>
      </div>
      <ol className='grid gap-3 sm:grid-cols-3 w-full text-start'>
        {steps.map(({ Icon, title, text }, i) => (
          <li key={i} className='rounded-xl bg-neutral-50 px-4 py-3.5'>
            <div className='flex items-center gap-2 text-sm font-semibold text-neutral-900'>
              <span className='w-6 h-6 rounded-md bg-white ring-1 ring-neutral-200 text-neutral-600 flex items-center justify-center'>
                <Icon size={13} />
              </span>
              {title}
            </div>
            <p className='mt-1.5 text-xs text-neutral-500 leading-relaxed'>{text}</p>
          </li>
        ))}
      </ol>
      <Button variant='primary' icon={<Plus size={14} weight='bold' />} onClick={onCreate}>
        {t('dashboard.assignments.home.new_assignment', { defaultValue: 'New Assignment' })}
      </Button>
    </div>
  )
}

function DueCell({ value, compact = false }: { value: string | null | undefined; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const date = formatShortDate(value, i18n.language)
  const state = dueStateOf(value)
  if (!date) {
    return compact ? null : <span className='text-sm text-neutral-400'>{t('dashboard.assignments.home.no_due_date')}</span>
  }
  const chip =
    state === 'overdue' ? (
      <Chip tone='rose' icon={<WarningCircle size={12} />}>{t('dashboard.assignments.list.due.overdue')}</Chip>
    ) : state === 'soon' ? (
      <Chip tone='amber' icon={<Clock size={12} />}>{t('dashboard.assignments.list.due.soon')}</Chip>
    ) : null
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 tabular-nums ${state === 'overdue' ? 'text-rose-600' : ''}`}>
        <CalendarBlank size={12} />
        {date}
        {chip}
      </span>
    )
  }
  return (
    <div className='flex flex-col items-start gap-1 min-w-0'>
      <span className={`text-sm tabular-nums ${state === 'overdue' ? 'text-rose-600' : 'text-neutral-700'}`}>{date}</span>
      {chip}
    </div>
  )
}

function CountsCell({ counts }: { counts: SubmissionCounts | null }) {
  const { t } = useTranslation()
  if (!counts) return <span className='text-sm text-neutral-300' aria-hidden>—</span>
  if (counts.total === 0) {
    return <span className='text-sm text-neutral-400'>{t('dashboard.assignments.list.counts.none')}</span>
  }
  return (
    <div className='flex flex-wrap items-center gap-1.5 min-w-0'>
      {counts.to_grade > 0 ? (
        <Chip tone='amber' icon={<UserCheck size={12} />} className='tabular-nums max-w-full overflow-hidden'>
          {t('dashboard.assignments.list.counts.to_grade', { count: counts.to_grade })}
        </Chip>
      ) : (
        <Chip tone='emerald' icon={<CheckCircle size={12} />}>{t('dashboard.assignments.list.counts.all_graded')}</Chip>
      )}
      <span className='text-xs text-neutral-500 tabular-nums'>
        {t('dashboard.assignments.list.counts.graded_of_total', { graded: counts.graded, total: counts.total })}
      </span>
    </div>
  )
}

function AssignmentRow({
  assignment,
  course,
  apiCounts,
  org,
  expanded,
  onToggleExpanded,
  onTogglePublished,
  onCopyLink,
}: {
  assignment: any
  course: any
  apiCounts: SubmissionCounts | null
  org: any
  expanded: boolean
  onToggleExpanded: () => void
  onTogglePublished: () => void
  onCopyLink: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const grading = gradingMetaFor(assignment)
  const GradingIcon = grading?.Icon
  const shortUuid = shortAssignmentUuid(assignment.assignment_uuid)
  const base = `/dash/assignments/${shortUuid}`
  const editorHref = { pathname: getUriWithOrg(org.slug, base), query: { subpage: 'editor' } }
  const courseEditorHref = {
    pathname: getUriWithOrg(org.slug, `/dash/courses/course/${shortCourseUuid(course.course_uuid)}/content`),
    query: { subpage: 'editor' },
  }

  // Lazy: only fetched once the row is opened. Same key (and cache) as the
  // full submissions tab, so going there afterwards is instant and grading in
  // either place refreshes both.
  const { data: submissions } = useQuery({
    queryKey: queryKeys.assignments.allSubmissions(shortUuid),
    queryFn: () => fetchAllAssignmentSubmissions(shortUuid, access_token),
    enabled: expanded && !!access_token,
    staleTime: 5_000,
    refetchInterval: expanded ? 15_000 : false,
  })
  // Prefer the live list when we have it (it reflects grading done a second
  // ago); otherwise the counts that came with the listing.
  const counts = Array.isArray(submissions) ? countsFromSubmissions(submissions) : apiCounts

  const statusLabel = assignment.published
    ? t('dashboard.assignments.detail.publishing.published')
    : t('dashboard.assignments.home.status_draft')
  const publishSwitch = (
    <label className='inline-flex items-center gap-2 cursor-pointer select-none' title={assignment.published ? t('dashboard.assignments.detail.publishing.unpublish_tooltip') : t('dashboard.assignments.detail.publishing.publish_tooltip')}>
      <Switch checked={!!assignment.published} onCheckedChange={onTogglePublished} aria-label={statusLabel} />
      <span className={`text-xs font-semibold ${assignment.published ? 'text-emerald-700' : 'text-neutral-500'}`}>{statusLabel}</span>
    </label>
  )

  return (
    <li className={`group relative ${ROW_GRID} ${expanded ? 'bg-neutral-50/60' : ''}`}>
      <div className={`px-4 sm:px-5 py-4 transition-colors ${expanded ? '' : 'hover:bg-neutral-50/70'} ${ROW_GRID}`}>
        {/* Title */}
        <div className='min-w-0'>
          <Link
            href={editorHref}
            prefetch
            className='text-sm font-semibold text-neutral-900 leading-snug hover:underline underline-offset-2 line-clamp-2 break-words'
          >
            {assignment.title || t('dashboard.assignments.home.untitled')}
          </Link>
          <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500'>
            {grading && GradingIcon && (
              <span className='inline-flex items-center gap-1'>
                <GradingIcon size={12} />
                {t(grading.labelKey)}
              </span>
            )}
            {assignment.auto_grading && (
              <span className='inline-flex items-center gap-1 text-violet-600' title={t('dashboard.assignments.detail.header_badges.auto_grading')}>
                <Lightning size={12} />
                <span className='xl:sr-only'>{t('dashboard.assignments.detail.header_badges.auto_grading')}</span>
              </span>
            )}
            {assignment.anti_copy_paste && (
              <span className='inline-flex items-center gap-1 text-sky-600' title={t('dashboard.assignments.detail.header_badges.anti_copy_paste')}>
                <ShieldCheck size={12} />
                <span className='sr-only'>{t('dashboard.assignments.detail.header_badges.anti_copy_paste')}</span>
              </span>
            )}
            {/* Below xl the other columns collapse into this line */}
            <span className='xl:hidden inline-flex items-center gap-1 min-w-0 max-w-full'>
              <StackSimple size={12} className='shrink-0' />
              <span className='truncate'>{course.name}</span>
            </span>
            <span className='xl:hidden'><DueCell value={assignment.due_date} compact /></span>
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

        {/* Submissions */}
        <div className='hidden xl:block min-w-0'><CountsCell counts={counts} /></div>

        {/* Due date */}
        <div className='hidden xl:block min-w-0'><DueCell value={assignment.due_date} /></div>

        {/* Status (quick publish) */}
        <div className='hidden xl:block'>{publishSwitch}</div>

        {/* Compact counts + status (below xl) */}
        <div className='xl:hidden mt-3 flex flex-wrap items-center justify-between gap-2'>
          {counts ? <CountsCell counts={counts} /> : <span />}
          {publishSwitch}
        </div>

        {/* Actions */}
        <div className='mt-3 xl:mt-0 flex items-center gap-1.5 xl:justify-end'>
          <Button
            size='sm'
            variant={expanded ? 'primary' : 'secondary'}
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            icon={<ClipboardText size={13} />}
            className='flex-1 xl:flex-none'
          >
            {t('dashboard.assignments.home.submissions')}
            {counts && counts.to_grade > 0 && (
              <span className={`min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 tabular-nums ${expanded ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>
                {counts.to_grade}
              </span>
            )}
            <CaretDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
          <Link href={editorHref} prefetch className={buttonClass('secondary', 'sm', 'flex-1 xl:flex-none')}>
            <PencilSimple size={13} />
            {t('dashboard.assignments.home.editor')}
          </Link>
          <Button
            size='icon'
            variant='ghost'
            onClick={onCopyLink}
            aria-label={t('dashboard.assignments.list.copy_link')}
            title={t('dashboard.assignments.list.copy_link')}
          >
            <LinkIcon size={15} />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className='xl:col-span-full px-4 sm:px-5 pb-4'>
          <SubmissionsPanel
            assignment={assignment}
            submissions={submissions}
            submissionsHref={{ pathname: getUriWithOrg(org.slug, base), query: { subpage: 'submissions' } }}
          />
        </div>
      )}
    </li>
  )
}

export default AssignmentsHome
