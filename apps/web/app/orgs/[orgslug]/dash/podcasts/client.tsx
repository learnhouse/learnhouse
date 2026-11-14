'use client'

import React, { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowsDownUp, CheckCircle, EyeSlash, Headphones, Plus, Tray, Waveform } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useDashNavPrefetch } from '@components/Dashboard/Shared/useDashNavPrefetch'
import { PodcastWithEpisodeCount } from '@services/podcasts/podcasts'
import { CreatePodcastModal } from '@components/Objects/Modals/Podcasts/CreatePodcastModal'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import {
  Button,
  DashPageHeader,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  ToolbarSelect,
  ViewToggle,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { asArray } from '@services/utils/ts/requests'
import { dashPodcastsQuery } from '@/lib/query/dashQueries'
import { searchMatchesAny } from '@/lib/search/normalize'
import {
  PODCAST_ROW_GRID,
  PODCAST_TABLE_GRID,
  PodcastCard,
  PodcastCardSkeleton,
  PodcastRow,
  PodcastRowSkeleton,
  dashPodcastsKey,
} from './_components/podcastItems'

interface PodcastsDashClientProps {
  org_id: number
  orgslug: string
}

type StatusFilter = 'all' | 'published' | 'drafts'
type SortKey = 'updated' | 'newest' | 'name' | 'episodes'

const SORT_KEYS = ['updated', 'newest', 'name', 'episodes'] as const
const VIEW_MODES = ['grid', 'list'] as const

const timeOf = (value?: string) => {
  const time = value ? new Date(value).getTime() : NaN
  return isNaN(time) ? 0 : time
}

function sortPodcasts(list: PodcastWithEpisodeCount[], sort: SortKey, locale: string) {
  const sorted = [...list]
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }))
    case 'newest':
      return sorted.sort((a, b) => timeOf(b.creation_date) - timeOf(a.creation_date))
    case 'episodes':
      return sorted.sort((a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0))
    default:
      return sorted.sort((a, b) => timeOf(b.update_date) - timeOf(a.update_date))
  }
}

const PodcastsDashClient = ({ org_id, orgslug }: PodcastsDashClientProps) => {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const rowPrefetch = useDashNavPrefetch()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Same options the sidebar warms on hover, so a revisit (or a hovered
  // link) paints from cache while it refreshes in the background.
  const { data, isFetching } = useQuery({
    ...dashPodcastsQuery(orgslug, accessToken),
    enabled: !!accessToken,
  })
  const podcasts = useMemo(() => asArray<PodcastWithEpisodeCount>(data), [data])
  const refresh = () => queryClient.invalidateQueries({ queryKey: dashPodcastsKey(orgslug) })

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useStoredState<SortKey>('lh_dash_podcasts_sort', 'updated', SORT_KEYS)
  const [view, setView] = useStoredState<'grid' | 'list'>('lh_dash_podcasts_view', 'grid', VIEW_MODES)

  const stats = useMemo(
    () => ({
      total: podcasts.length,
      published: podcasts.filter((p) => p.published).length,
      drafts: podcasts.filter((p) => !p.published).length,
      episodes: podcasts.reduce((sum, p) => sum + (p.episode_count ?? 0), 0),
    }),
    [podcasts]
  )

  const filtered = useMemo(() => {
    let list = podcasts
    if (status === 'published') list = list.filter((p) => p.published)
    if (status === 'drafts') list = list.filter((p) => !p.published)
    if (deferredSearch.trim()) {
      list = list.filter((p) => searchMatchesAny([p.name, p.description, p.tags], deferredSearch))
    }
    return sortPodcasts(list, sort, i18n.language)
  }, [podcasts, status, deferredSearch, sort, i18n.language])

  const hasActiveFilters = !!search || status !== 'all'
  const clearFilters = () => {
    setSearch('')
    setStatus('all')
  }

  // Only the very first load (nothing cached yet, still fetching) shows
  // skeletons; refetches keep the current list on screen.
  const loading = podcasts.length === 0 && isFetching

  const newPodcastButton = (
    <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setIsCreateModalOpen(true)}>
      {t('podcasts.new_podcast')}
    </Button>
  )

  return (
    <FeatureGate feature="podcasts" orgslug={orgslug} context="dashboard">
      {/* Hovering a row warms its editor route, so opening it is instant. */}
      <div {...rowPrefetch} className="px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0">
        <DashPageHeader
          breadcrumbs={[{ label: t('podcasts.podcasts'), href: '/dash/podcasts', icon: <Headphones size={14} /> }]}
          title={t('podcasts.podcasts')}
          subtitle={t('podcasts.dashboard.list.subtitle')}
          actions={
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="podcasts" orgId={org_id}>
              {newPodcastButton}
            </AuthenticatedClientElement>
          }
        />

        {/* Stats double as quick filters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Headphones size={16} />}
            iconClass="bg-neutral-100 text-neutral-600"
            label={t('podcasts.dashboard.list.stats.total')}
            value={loading ? null : stats.total}
            active={!hasActiveFilters}
            onClick={clearFilters}
          />
          <StatCard
            icon={<CheckCircle size={16} />}
            iconClass="bg-emerald-50 text-emerald-600"
            label={t('podcasts.dashboard.list.stats.published')}
            value={loading ? null : stats.published}
            active={status === 'published'}
            onClick={() => setStatus(status === 'published' ? 'all' : 'published')}
          />
          <StatCard
            icon={<EyeSlash size={16} />}
            iconClass="bg-amber-50 text-amber-600"
            label={t('podcasts.dashboard.list.stats.drafts')}
            value={loading ? null : stats.drafts}
            active={status === 'drafts'}
            onClick={() => setStatus(status === 'drafts' ? 'all' : 'drafts')}
          />
          <StatCard
            icon={<Waveform size={16} />}
            iconClass="bg-violet-50 text-violet-600"
            label={t('podcasts.dashboard.list.stats.episodes')}
            value={loading ? null : stats.episodes}
          />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('podcasts.search_placeholder')}
            className="xl:max-w-md"
          />
          <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
            <SegmentedControl<StatusFilter>
              value={status}
              onChange={setStatus}
              ariaLabel={t('podcasts.dashboard.list.status_filter')}
              options={[
                { key: 'all', label: t('podcasts.dashboard.list.filters.all') },
                { key: 'published', label: t('podcasts.dashboard.list.filters.published') },
                { key: 'drafts', label: t('podcasts.dashboard.list.filters.drafts') },
              ]}
            />
            <ToolbarSelect
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              ariaLabel={t('podcasts.dashboard.list.sort_label')}
              icon={<ArrowsDownUp size={14} />}
              options={[
                { value: 'updated', label: t('podcasts.dashboard.list.sort.updated') },
                { value: 'newest', label: t('podcasts.dashboard.list.sort.newest') },
                { value: 'name', label: t('podcasts.dashboard.list.sort.name') },
                { value: 'episodes', label: t('podcasts.dashboard.list.sort.episodes') },
              ]}
            />
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        {!loading && podcasts.length > 0 && (
          <div className="flex items-center justify-between gap-3 -mt-1 text-xs text-neutral-500">
            <span className="tabular-nums">
              {t('podcasts.dashboard.list.showing_count', { shown: filtered.length, total: podcasts.length })}
            </span>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="font-semibold text-neutral-700 hover:text-neutral-900">
                {t('podcasts.dashboard.list.clear_filters')}
              </button>
            )}
          </div>
        )}

        {loading ? (
          view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <PodcastCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <PodcastRowSkeleton key={i} />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl nice-shadow">
            {hasActiveFilters ? (
              <EmptyState
                icon={<Tray size={22} />}
                title={t('podcasts.no_search_results')}
                description={t('podcasts.try_different_search')}
                action={
                  <Button size="sm" onClick={clearFilters}>
                    {t('podcasts.dashboard.list.clear_filters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Headphones size={22} />}
                title={t('podcasts.no_podcasts')}
                description={t('podcasts.create_podcasts_placeholder')}
                action={
                  <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="podcasts" orgId={org_id}>
                    <div className="mt-1">{newPodcastButton}</div>
                  </AuthenticatedClientElement>
                }
              />
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((podcast) => (
              <PodcastCard
                key={podcast.podcast_uuid}
                podcast={podcast}
                orgslug={orgslug}
                orgUuid={org?.org_uuid}
                onChanged={refresh}
              />
            ))}
          </div>
        ) : (
          <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${PODCAST_TABLE_GRID}`}>
            <div className={`hidden ${PODCAST_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('podcasts.dashboard.list.columns.podcast')}</span>
              <span>{t('common.status')}</span>
              <span>{t('podcasts.dashboard.list.columns.visibility')}</span>
              <span>{t('podcasts.episodes')}</span>
              <span>{t('podcasts.dashboard.list.columns.authors')}</span>
              <span>{t('podcasts.dashboard.list.columns.updated')}</span>
              <span className="sr-only">{t('podcasts.actions')}</span>
            </div>
            <ul className={`divide-y divide-neutral-100 ${PODCAST_ROW_GRID}`}>
              {filtered.map((podcast) => (
                <PodcastRow
                  key={podcast.podcast_uuid}
                  podcast={podcast}
                  orgslug={orgslug}
                  orgUuid={org?.org_uuid}
                  onChanged={refresh}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <CreatePodcastModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        orgId={org_id}
        orgSlug={orgslug}
      />
    </FeatureGate>
  )
}

export default PodcastsDashClient
