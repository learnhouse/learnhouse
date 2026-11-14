'use client'
import React, { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowsDownUp, Books, CheckCircle, Copy, DownloadSimple, Eye, EyeSlash, Tray, Lock, Plus, Trash, Users } from '@phosphor-icons/react'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import CatalogPagination, { useCatalogPagination } from '@components/Objects/Catalog/CatalogPagination'
import {
  BTN_PRIMARY,
  BTN_SECONDARY_SM,
  BulkActionBar,
  BulkActionButton,
  ConfirmDialog,
  DashPageHeader,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ToolbarSelect,
  ViewToggle,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import { cloneCourse, deleteCourseFromBackend, getAllOrgCourses, updateCourse } from '@services/courses/courses'
import { exportCoursesBatch, downloadBlob, ExportStatus } from '@services/courses/transfer'
import { exportToast } from '@components/Objects/StyledElements/Toast/ExportToast'
import { asArray } from '@services/utils/ts/requests'
import { getUserGroups, getUserGroupResources } from '@services/usergroups/usergroups'
import { searchMatchesAny } from '@/lib/search/normalize'
import { queryKeys } from '@/lib/query/keys'
import { DashCourse, runPool, usePatchCourseInCache } from './_components/courseActions'
import {
  COURSE_ROW_GRID,
  COURSE_TABLE_GRID,
  CourseCard,
  CourseCardSkeleton,
  CourseRow,
  CourseRowSkeleton,
} from './_components/courseItems'
import CourseCreationModals from './_components/CourseCreationModals'

type StatusFilter = 'all' | 'published' | 'drafts'
type VisibilityFilter = 'all' | 'public' | 'private'
type SortKey = 'updated' | 'newest' | 'oldest' | 'name'

const SORT_KEYS = ['updated', 'newest', 'oldest', 'name'] as const
const VIEW_MODES = ['grid', 'list'] as const
const PAGE_SIZE = 24

const timeOf = (value?: string) => {
  const time = value ? new Date(value).getTime() : NaN
  return isNaN(time) ? 0 : time
}

function sortCourses(courses: DashCourse[], sort: SortKey, locale: string) {
  const sorted = [...courses]
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }))
    case 'newest':
      return sorted.sort((a, b) => timeOf(b.creation_date) - timeOf(a.creation_date))
    case 'oldest':
      return sorted.sort((a, b) => timeOf(a.creation_date) - timeOf(b.creation_date))
    default:
      return sorted.sort((a, b) => timeOf(b.update_date) - timeOf(a.update_date))
  }
}

function CoursesHome({ orgslug }: { orgslug: string }) {
  const { t, i18n } = useTranslation()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const orgId = org?.id as number | undefined
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { isAdmin: isAdminStatus } = useAdminStatus()
  const isAdmin = !!isAdminStatus
  const patchCourses = usePatchCourseInCache(orgslug)

  const isCoursesEnabled =
    org?.config?.config?.resolved_features?.courses?.enabled ??
    org?.config?.config?.features?.courses?.enabled !== false

  const { data: coursesData, isLoading } = useQuery({
    queryKey: queryKeys.courses.dashAll(orgslug),
    queryFn: () => getAllOrgCourses(orgslug, accessToken),
    enabled: isCoursesEnabled && !!accessToken,
    staleTime: 60_000,
  })
  const allCourses: DashCourse[] = useMemo(() => coursesData ?? [], [coursesData])

  const { data: usageData } = useQuery<OrgUsageResponse>({
    queryKey: queryKeys.org.usage(orgId!),
    queryFn: () => orgUsageFetcher(`${getAPIUrl()}orgs/${orgId}/usage`, accessToken),
    enabled: !!accessToken && !!orgId,
    staleTime: 60_000,
  })
  const courseLimitReached = usageData?.features?.courses?.limit_reached ?? false
  const courseLimit = usageData?.features?.courses?.limit ?? 0

  // The course count feeds the plan usage numbers, which drive the "limit
  // reached" state of the New Course button, so refresh both together.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(orgslug) })
    if (orgId) queryClient.invalidateQueries({ queryKey: queryKeys.org.usage(orgId) })
  }

  // ---- usergroup filter (only when the plan includes usergroups) ----
  const usergroupsAvailable = org?.config?.config?.resolved_features?.usergroups?.enabled ?? false
  const [usergroupId, setUsergroupId] = useStoredState<string>('lh_course_usergroup_filter', '')
  const { data: usergroups = [] } = useQuery({
    queryKey: ['usergroups', orgId],
    queryFn: async () => asArray(await getUserGroups(orgId!, accessToken)),
    enabled: usergroupsAvailable && !!accessToken && !!orgId,
    staleTime: 5 * 60_000,
  })
  // A saved group that no longer exists is ignored rather than filtering
  // everything out.
  const activeUsergroupId = usergroups.some((ug: any) => String(ug.id) === usergroupId) ? usergroupId : ''
  const { data: usergroupResources } = useQuery({
    queryKey: ['usergroups', orgId, activeUsergroupId, 'resources'],
    queryFn: async () => new Set<string>(asArray(await getUserGroupResources(activeUsergroupId, orgId!, accessToken))),
    enabled: !!activeUsergroupId && !!accessToken && !!orgId,
    staleTime: 60_000,
  })

  // ---- filters ----
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [visibility, setVisibility] = useState<VisibilityFilter>('all')
  const [sort, setSort] = useStoredState<SortKey>('lh_dash_courses_sort', 'updated', SORT_KEYS)
  const [view, setView] = useStoredState<'grid' | 'list'>('lh_dash_courses_view', 'grid', VIEW_MODES)

  const stats = useMemo(
    () => ({
      total: allCourses.length,
      published: allCourses.filter((c) => c.published).length,
      drafts: allCourses.filter((c) => !c.published).length,
      private: allCourses.filter((c) => !c.public).length,
    }),
    [allCourses]
  )

  const filtered = useMemo(() => {
    let list = allCourses
    if (activeUsergroupId && usergroupResources) list = list.filter((c) => usergroupResources.has(c.course_uuid))
    if (status === 'published') list = list.filter((c) => c.published)
    if (status === 'drafts') list = list.filter((c) => !c.published)
    if (visibility === 'public') list = list.filter((c) => c.public)
    if (visibility === 'private') list = list.filter((c) => !c.public)
    if (deferredSearch.trim()) {
      list = list.filter((c) => searchMatchesAny([c.name, c.description, c.tags], deferredSearch))
    }
    return sortCourses(list, sort, i18n.language)
  }, [allCourses, activeUsergroupId, usergroupResources, status, visibility, deferredSearch, sort, i18n.language])

  const hasActiveFilters = !!search || status !== 'all' || visibility !== 'all' || !!activeUsergroupId
  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setVisibility('all')
    setUsergroupId('')
  }

  const { currentPage, totalPages, paginatedItems, pageNumbers, goToPage, resetPage } = useCatalogPagination(
    filtered,
    PAGE_SIZE
  )
  React.useEffect(() => {
    resetPage()
  }, [deferredSearch, status, visibility, activeUsergroupId, sort, resetPage])

  // ---- selection ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastToggled = React.useRef<string | null>(null)
  // Drop selections that the filters no longer show, so bulk actions only
  // ever touch courses the user can see.
  const visibleSelected = useMemo(() => {
    const visible = new Set(filtered.map((c) => c.course_uuid))
    return new Set([...selected].filter((uuid) => visible.has(uuid)))
  }, [selected, filtered])
  const selectedCourses = useMemo(
    () => filtered.filter((c) => visibleSelected.has(c.course_uuid)),
    [filtered, visibleSelected]
  )

  const toggleSelect = (uuid: string, shiftKey: boolean) => {
    // Read the anchor now: the updater below runs later, after the ref moved.
    const anchor = lastToggled.current
    setSelected((prev) => {
      const next = new Set(prev)
      // Shift-click selects the whole run on the current page.
      if (shiftKey && anchor) {
        const uuids = paginatedItems.map((c) => c.course_uuid)
        const from = uuids.indexOf(anchor)
        const to = uuids.indexOf(uuid)
        if (from !== -1 && to !== -1) {
          const [a, b] = from < to ? [from, to] : [to, from]
          uuids.slice(a, b + 1).forEach((u) => next.add(u))
          return next
        }
      }
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
    lastToggled.current = uuid
  }
  const clearSelection = () => setSelected(new Set())
  const pageUuids = paginatedItems.map((c) => c.course_uuid)
  const pageAllSelected = pageUuids.length > 0 && pageUuids.every((u) => visibleSelected.has(u))
  const togglePageSelection = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) pageUuids.forEach((u) => next.delete(u))
      else pageUuids.forEach((u) => next.add(u))
      return next
    })

  // ---- bulk actions ----
  const [bulkConfirm, setBulkConfirm] = useState<'delete' | 'clone' | null>(null)
  const count = selectedCourses.length

  const bulkPublish = async (published: boolean) => {
    const uuids = selectedCourses.map((c) => c.course_uuid)
    const rollback = patchCourses(uuids, { published })
    const { failed } = await runPool(uuids, async (uuid) => {
      await updateCourse(uuid, { published }, accessToken)
      return true
    })
    if (failed) {
      rollback()
      toast.error(t('dashboard.courses.home.bulk_partial', { count: failed }))
    } else {
      toast.success(
        published
          ? t('dashboard.courses.home.bulk_published', { count: uuids.length })
          : t('dashboard.courses.home.bulk_unpublished', { count: uuids.length })
      )
    }
    clearSelection()
    refresh()
  }

  const bulkDelete = async () => {
    const toastId = toast.loading(t('courses.deleting_courses', { count }))
    const { ok, failed } = await runPool(selectedCourses, async (c) => {
      await deleteCourseFromBackend(c.course_uuid, accessToken)
      return true
    })
    if (failed === 0) toast.success(t('courses.courses_deleted_success', { count: ok }), { id: toastId })
    else toast.error(t('courses.courses_deleted_partial', { success: ok, error: failed }), { id: toastId })
    clearSelection()
    refresh()
  }

  const bulkClone = async () => {
    const toastId = toast.loading(t('courses.cloning_courses', { count }))
    const { ok, failed } = await runPool(
      selectedCourses,
      async (c) => !!(await cloneCourse(c.course_uuid, accessToken))?.success,
      2
    )
    if (failed === 0) toast.success(t('courses.courses_cloned_success', { count: ok }), { id: toastId })
    else toast.error(t('courses.courses_cloned_partial', { success: ok, error: failed }), { id: toastId })
    clearSelection()
    refresh()
  }

  const bulkExport = async () => {
    const toastId = exportToast.start('batch', undefined, count)
    try {
      const blob = await exportCoursesBatch(
        selectedCourses.map((c) => c.course_uuid),
        accessToken,
        (progress, exportStatus) => {
          exportToast.update(toastId, exportStatus as ExportStatus, progress, undefined, count, 'batch')
        }
      )
      downloadBlob(blob, `learnhouse-courses-export-${new Date().toISOString().split('T')[0]}.zip`)
      exportToast.complete(toastId, undefined, count, 'batch')
    } catch (error: any) {
      exportToast.error(toastId, error.message || t('courses.courses_exported_error'), undefined, count, 'batch')
    }
    clearSelection()
  }

  // ---- creation modals ----
  const [createOpen, setCreateOpen] = useState(() => !!searchParams.get('new'))

  const newCourseButton = (
    <button
      type="button"
      onClick={() => setCreateOpen(true)}
      disabled={courseLimitReached}
      className={BTN_PRIMARY}
    >
      <Plus size={16} />
      {t('courses.new_course')}
    </button>
  )

  const loading = isLoading || (!coursesData && !!accessToken && isCoursesEnabled)

  return (
    <FeatureGate feature="courses" orgslug={orgslug} context="dashboard">
      <div className="flex w-full">
        <div className="px-4 sm:px-10 pb-24 flex flex-col gap-5 w-full min-w-0">
          <DashPageHeader
            breadcrumbs={[{ label: t('courses.courses'), href: '/dash/courses', icon: <Books size={14} /> }]}
            title={t('dashboard.courses.title')}
            subtitle={t('dashboard.courses.home.subtitle')}
            actions={
              <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="courses" orgId={orgId!}>
                <CourseCreationModals
                  orgslug={orgslug}
                  orgId={orgId!}
                  open={createOpen}
                  onOpenChange={setCreateOpen}
                  limitReached={courseLimitReached}
                  limit={courseLimit}
                  onCreated={refresh}
                  newCourseButton={newCourseButton}
                />
              </AuthenticatedClientElement>
            }
          />

          {/* Stats double as quick filters */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Books size={16} />}
              iconClass="bg-neutral-100 text-neutral-600"
              label={t('dashboard.courses.home.stats.total')}
              value={loading ? null : stats.total}
              active={!hasActiveFilters}
              onClick={clearFilters}
            />
            <StatCard
              icon={<CheckCircle size={16} />}
              iconClass="bg-emerald-50 text-emerald-600"
              label={t('dashboard.courses.home.stats.published')}
              value={loading ? null : stats.published}
              active={status === 'published'}
              onClick={() => setStatus(status === 'published' ? 'all' : 'published')}
            />
            <StatCard
              icon={<EyeSlash size={16} />}
              iconClass="bg-amber-50 text-amber-600"
              label={t('dashboard.courses.home.stats.drafts')}
              value={loading ? null : stats.drafts}
              active={status === 'drafts'}
              onClick={() => setStatus(status === 'drafts' ? 'all' : 'drafts')}
            />
            <StatCard
              icon={<Lock size={16} />}
              iconClass="bg-violet-50 text-violet-600"
              label={t('dashboard.courses.home.stats.private')}
              value={loading ? null : stats.private}
              active={visibility === 'private'}
              onClick={() => setVisibility(visibility === 'private' ? 'all' : 'private')}
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('courses.search_courses')}
              className="xl:max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
              <SegmentedControl<StatusFilter>
                value={status}
                onChange={setStatus}
                ariaLabel={t('dashboard.courses.home.status_filter')}
                options={[
                  { key: 'all', label: t('dashboard.courses.home.filters.all') },
                  { key: 'published', label: t('dashboard.courses.home.filters.published') },
                  { key: 'drafts', label: t('dashboard.courses.home.filters.drafts') },
                ]}
              />
              <ToolbarSelect
                value={visibility}
                onChange={(v) => setVisibility(v as VisibilityFilter)}
                ariaLabel={t('dashboard.courses.home.visibility_filter')}
                options={[
                  { value: 'all', label: t('dashboard.courses.home.filters.any_visibility') },
                  { value: 'public', label: t('courses.public') },
                  { value: 'private', label: t('courses.private') },
                ]}
              />
              {usergroupsAvailable && usergroups.length > 0 && (
                <ToolbarSelect
                  value={activeUsergroupId}
                  onChange={setUsergroupId}
                  ariaLabel={t('courses.usergroup_filter.info_title')}
                  icon={<Users size={14} />}
                  options={[
                    { value: '', label: t('courses.usergroup_filter.all_courses') },
                    ...usergroups.map((ug: any) => ({ value: String(ug.id), label: ug.name })),
                  ]}
                />
              )}
              <ToolbarSelect
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                ariaLabel={t('dashboard.courses.home.sort_label')}
                icon={<ArrowsDownUp size={14} />}
                options={[
                  { value: 'updated', label: t('dashboard.courses.home.sort.updated') },
                  { value: 'newest', label: t('dashboard.courses.home.sort.newest') },
                  { value: 'oldest', label: t('dashboard.courses.home.sort.oldest') },
                  { value: 'name', label: t('dashboard.courses.home.sort.name') },
                ]}
              />
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>

          {/* Results line */}
          {!loading && allCourses.length > 0 && (
            <div className="flex items-center justify-between gap-3 -mt-1 text-xs text-neutral-500">
              <span className="tabular-nums">
                {t('dashboard.courses.home.showing_count', { shown: filtered.length, total: allCourses.length })}
              </span>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="font-semibold text-neutral-700 hover:text-neutral-900">
                  {t('dashboard.courses.home.clear_filters')}
                </button>
              )}
            </div>
          )}

          {/* Content */}
          {loading ? (
            view === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <CourseCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CourseRowSkeleton key={i} />
                ))}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl nice-shadow">
              {hasActiveFilters ? (
                <EmptyState
                  icon={<Tray size={22} />}
                  title={t('courses.no_search_results')}
                  description={t('courses.try_different_search')}
                  action={
                    <button type="button" onClick={clearFilters} className={BTN_SECONDARY_SM}>
                      {t('dashboard.courses.home.clear_filters')}
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Books size={22} />}
                  title={t('dashboard.courses.no_courses')}
                  description={
                    isAdmin ? t('dashboard.courses.create_course_placeholder') : t('dashboard.courses.no_courses_available')
                  }
                  action={
                    isAdmin && !courseLimitReached ? (
                      <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="courses" orgId={orgId!}>
                        <div className="mt-1">{newCourseButton}</div>
                      </AuthenticatedClientElement>
                    ) : undefined
                  }
                />
              )}
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedItems.map((course) => (
                <CourseCard
                  key={course.course_uuid}
                  course={course}
                  orgslug={orgslug}
                  orgUuid={org?.org_uuid}
                  selected={visibleSelected.has(course.course_uuid)}
                  selectable={isAdmin}
                  onToggleSelect={toggleSelect}
                  onChanged={refresh}
                />
              ))}
            </div>
          ) : (
            <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${COURSE_TABLE_GRID}`}>
              <div className={`hidden ${COURSE_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
                <span className="flex items-center">
                  {isAdmin ? (
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={togglePageSelection}
                      aria-label={t('courses.select_all')}
                      className="w-4 h-4 rounded border-neutral-300 accent-neutral-900 cursor-pointer"
                    />
                  ) : (
                    <span className="w-5" />
                  )}
                </span>
                <span>{t('dashboard.courses.home.columns.course')}</span>
                <span>{t('common.status')}</span>
                <span>{t('dashboard.courses.home.columns.visibility')}</span>
                <span>{t('dashboard.courses.home.columns.authors')}</span>
                <span>{t('dashboard.courses.home.columns.updated')}</span>
                <span className="sr-only">{t('courses.actions')}</span>
              </div>
              <ul className={`divide-y divide-neutral-100 ${COURSE_ROW_GRID}`}>
                {paginatedItems.map((course) => (
                  <CourseRow
                    key={course.course_uuid}
                    course={course}
                    orgslug={orgslug}
                    orgUuid={org?.org_uuid}
                    selected={visibleSelected.has(course.course_uuid)}
                    selectable={isAdmin}
                    onToggleSelect={toggleSelect}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            </div>
          )}

          <CatalogPagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageNumbers={pageNumbers}
            onPageChange={(page) => page >= 1 && page <= totalPages && goToPage(page)}
            previousLabel={t('pagination.previous')}
            nextLabel={t('pagination.next')}
            className="mt-2"
          />
        </div>
      </div>

      <AuthenticatedClientElement checkMethod="roles" action="update" ressourceType="courses" orgId={orgId!}>
        <BulkActionBar
          count={count}
          label={t('courses.selected_count', { count })}
          onClear={clearSelection}
        >
          {count < filtered.length && (
            <BulkActionButton
              icon={<CheckCircle size={14} />}
              label={t('dashboard.courses.home.select_all_count', { count: filtered.length })}
              onClick={() => setSelected(new Set(filtered.map((c) => c.course_uuid)))}
            />
          )}
          <BulkActionButton icon={<Eye size={14} />} label={t('dashboard.courses.home.publish')} onClick={() => bulkPublish(true)} />
          <BulkActionButton
            icon={<EyeSlash size={14} />}
            label={t('dashboard.courses.home.unpublish')}
            onClick={() => bulkPublish(false)}
          />
          <BulkActionButton icon={<Copy size={14} />} label={t('courses.clone_selected')} onClick={() => setBulkConfirm('clone')} />
          <BulkActionButton icon={<DownloadSimple size={14} />} label={t('courses.export_selected')} onClick={bulkExport} />
          <BulkActionButton
            icon={<Trash size={14} />}
            label={t('courses.delete_selected')}
            onClick={() => setBulkConfirm('delete')}
            danger
          />
        </BulkActionBar>
      </AuthenticatedClientElement>

      <ConfirmDialog
        open={bulkConfirm === 'delete'}
        onOpenChange={(open) => !open && setBulkConfirm(null)}
        title={t('courses.delete_courses_title')}
        message={t('courses.delete_selected_confirm', { count })}
        confirmLabel={t('courses.delete_selected')}
        onConfirm={bulkDelete}
      />
      <ConfirmDialog
        open={bulkConfirm === 'clone'}
        onOpenChange={(open) => !open && setBulkConfirm(null)}
        title={t('courses.clone_courses_title')}
        message={t('courses.clone_selected_confirm', { count })}
        confirmLabel={t('courses.clone_selected')}
        tone="info"
        onConfirm={bulkClone}
      />
    </FeatureGate>
  )
}

export default CoursesHome
