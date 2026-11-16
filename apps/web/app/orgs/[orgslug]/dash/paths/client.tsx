'use client'

import React, { useMemo, useState } from 'react'
import { ArrowsDownUp, CheckCircle, Medal, Plus, Circuitry as PathIcon, Users } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { CreatePathModal } from '@components/Objects/Modals/Paths/CreatePathModal'
import {
  BTN_PRIMARY,
  BTN_SECONDARY_SM,
  DashPageHeader,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ToolbarSelect,
  ViewToggle,
  useStoredState,
  type ViewMode,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { usePaths } from '@/hooks/queries/usePaths'
import { Path } from '@services/paths/paths'
import { PathsIntro } from '@components/Objects/Paths/PathTrack'
import {
  PATH_ROW_GRID,
  PATH_TABLE_GRID,
  PathGridCard,
  PathGridCardSkeleton,
  PathListRow,
  PathListRowSkeleton,
} from './_components/PathDashItems'

interface PathsDashClientProps {
  org_id: number
  orgslug: string
}

type StatusFilter = 'all' | 'published' | 'drafts'
type SortKey = 'updated' | 'newest' | 'name'

const VIEW_MODES: readonly ViewMode[] = ['grid', 'list']
const SORT_KEYS: readonly SortKey[] = ['updated', 'newest', 'name']

function timeOf(value?: string) {
  const time = value ? new Date(value).getTime() : 0
  return isNaN(time) ? 0 : time
}

const PathsDashClient = ({ org_id, orgslug }: PathsDashClientProps) => {
  const { t } = useTranslation()
  const { data: paths, isLoading } = usePaths(org_id)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useStoredState<SortKey>('lh-dash-paths-sort', 'updated', SORT_KEYS)
  const [view, setView] = useStoredState<ViewMode>('lh-dash-paths-view', 'grid', VIEW_MODES)

  const all: Path[] = useMemo(() => paths ?? [], [paths])
  const stats = useMemo(
    () => ({
      total: all.length,
      published: all.filter((p) => p.published).length,
      drafts: all.filter((p) => !p.published).length,
      learners: all.reduce((sum, p) => sum + (p.enrollment_count || 0), 0),
      certified: all.filter((p) => p.certificate_enabled).length,
    }),
    [all]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = all.filter((p) => {
      if (status === 'published' && !p.published) return false
      if (status === 'drafts' && p.published) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    })
    return [...rows].sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sort === 'newest') return timeOf(b.creation_date) - timeOf(a.creation_date)
      return timeOf(b.update_date) - timeOf(a.update_date)
    })
  }, [all, search, status, sort])

  const loading = isLoading || !paths
  const hasFilters = !!search.trim() || status !== 'all'
  const clearFilters = () => {
    setSearch('')
    setStatus('all')
  }
  // Clicking a stat card filters to it; clicking it again goes back to all.
  const toggleStatus = (next: StatusFilter) => setStatus((current) => (current === next ? 'all' : next))

  const newPathButton = (
    <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="courses" orgId={org_id}>
      <button type="button" onClick={() => setIsCreateModalOpen(true)} className={BTN_PRIMARY}>
        <Plus size={16} />
        {t('paths.new_path')}
      </button>
    </AuthenticatedClientElement>
  )

  const empty =
    !loading &&
    visible.length === 0 &&
    (hasFilters ? (
      <EmptyState
        icon={<PathIcon size={22} />}
        title={t('paths.dashboard.empty_filtered')}
        action={
          <button type="button" onClick={clearFilters} className={BTN_SECONDARY_SM}>
            {t('paths.dashboard.clear_filters')}
          </button>
        }
      />
    ) : (
      <PathsIntro
        title={t('paths.intro.dash_title')}
        description={t('paths.intro.dash_description')}
        points={[t('paths.intro.ordered'), t('paths.intro.electives'), t('paths.intro.certificate')]}
        action={newPathButton}
      />
    ))

  return (
    <FeatureGate feature="paths" orgslug={orgslug} context="dashboard">
      <div className="flex w-full">
        <div className="px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0">
          <DashPageHeader
            breadcrumbs={[{ label: t('paths.title'), href: '/dash/paths', icon: <PathIcon size={14} /> }]}
            title={t('paths.title')}
            subtitle={t('paths.dashboard.subtitle')}
            actions={newPathButton}
          />

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<PathIcon size={16} />}
              iconClass="bg-neutral-100 text-neutral-600"
              label={t('paths.dashboard.stats.total')}
              value={loading ? null : stats.total}
              onClick={() => setStatus('all')}
            />
            <StatCard
              icon={<CheckCircle size={16} />}
              iconClass="bg-emerald-50 text-emerald-600"
              label={t('paths.dashboard.stats.published')}
              value={loading ? null : stats.published}
              active={status === 'published'}
              onClick={() => toggleStatus('published')}
            />
            <StatCard
              icon={<Users size={16} />}
              iconClass="bg-sky-50 text-sky-600"
              label={t('paths.dashboard.stats.learners')}
              value={loading ? null : stats.learners}
            />
            <StatCard
              icon={<Medal size={16} />}
              iconClass="bg-amber-50 text-amber-600"
              label={t('paths.dashboard.stats.certified')}
              value={loading ? null : stats.certified}
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('paths.search_placeholder')}
              className="lg:max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
              <SegmentedControl<StatusFilter>
                value={status}
                onChange={setStatus}
                ariaLabel={t('common.status')}
                options={[
                  { key: 'all', label: t('paths.dashboard.filters.all'), count: loading ? undefined : stats.total },
                  { key: 'published', label: t('paths.dashboard.filters.published'), count: loading ? undefined : stats.published },
                  { key: 'drafts', label: t('paths.dashboard.filters.drafts'), count: loading ? undefined : stats.drafts },
                ]}
              />
              <ToolbarSelect
                value={sort}
                onChange={(value) => setSort(value as SortKey)}
                ariaLabel={t('paths.dashboard.sort.label')}
                icon={<ArrowsDownUp size={14} />}
                options={[
                  { value: 'updated', label: t('paths.dashboard.sort.updated') },
                  { value: 'newest', label: t('paths.dashboard.sort.newest') },
                  { value: 'name', label: t('paths.dashboard.sort.name') },
                ]}
              />
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>

          {/* Grid view */}
          {view === 'grid' &&
            (empty ? (
              <div className="bg-white rounded-2xl nice-shadow">{empty}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {loading
                  ? [1, 2, 3, 4].map((i) => <PathGridCardSkeleton key={i} />)
                  : visible.map((path) => <PathGridCard key={path.path_uuid} path={path} orgslug={orgslug} />)}
              </div>
            ))}

          {/* List view */}
          {view === 'list' && (
            <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${PATH_TABLE_GRID}`}>
              <div className={`hidden ${PATH_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
                <span>{t('paths.dashboard.columns.path')}</span>
                <span>{t('paths.dashboard.columns.journey')}</span>
                <span>{t('paths.dashboard.columns.learners')}</span>
                <span>{t('paths.dashboard.columns.updated')}</span>
                <span>{t('common.status')}</span>
                <span className="sr-only">{t('paths.actions')}</span>
              </div>

              {loading && (
                <div className="animate-pulse divide-y divide-neutral-100 xl:col-span-full">
                  {[1, 2, 3, 4].map((i) => (
                    <PathListRowSkeleton key={i} />
                  ))}
                </div>
              )}

              {empty && <div className="xl:col-span-full">{empty}</div>}

              {!loading && visible.length > 0 && (
                <ul className={`divide-y divide-neutral-100 ${PATH_ROW_GRID}`}>
                  {visible.map((path) => (
                    <PathListRow key={path.path_uuid} path={path} orgslug={orgslug} />
                  ))}
                </ul>
              )}

              {!loading && visible.length > 0 && (
                <div className="px-5 py-3 border-t border-neutral-100 text-xs text-neutral-500 tabular-nums xl:col-span-full">
                  {t('paths.dashboard.showing_count', { shown: visible.length, total: stats.total })}
                </div>
              )}
            </div>
          )}
        </div>

        <CreatePathModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          orgId={org_id}
          orgSlug={orgslug}
        />
      </div>
    </FeatureGate>
  )
}

export default PathsDashClient
