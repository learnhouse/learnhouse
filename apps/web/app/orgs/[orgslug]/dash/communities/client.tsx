'use client'

import React, { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowsDownUp, BookOpen, Garage, Globe, Lock, Plus, Tray } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useDashNavPrefetch } from '@components/Dashboard/Shared/useDashNavPrefetch'
import { Community, deleteCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { dashCommunitiesQuery } from '@/lib/query/dashQueries'
import { searchMatchesAny } from '@/lib/search/normalize'
import { CreateCommunityModal } from '@components/Objects/Modals/Communities/CreateCommunityModal'
import { EditCommunityModal } from '@components/Objects/Modals/Communities/EditCommunityModal'
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
import {
  COMMUNITY_ROW_GRID,
  COMMUNITY_TABLE_GRID,
  CommunityCard,
  CommunityCardSkeleton,
  CommunityRow,
  CommunityRowSkeleton,
} from './_components/communityItems'
import { dashCommunityKeys, useOrgCommunityActivity } from './_components/communityActivity'

interface CommunitiesDashClientProps {
  org_id: number
  orgslug: string
}

type VisibilityFilter = 'all' | 'public' | 'private'
type SortKey = 'updated' | 'newest' | 'name'

const SORT_KEYS = ['updated', 'newest', 'name'] as const
const VIEW_MODES = ['grid', 'list'] as const

const timeOf = (value?: string) => {
  const time = value ? new Date(value).getTime() : NaN
  return isNaN(time) ? 0 : time
}

const CommunitiesDashClient = ({ org_id, orgslug }: CommunitiesDashClientProps) => {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const rowPrefetch = useDashNavPrefetch()
  const listKey = queryKeys.community.list(org_id)

  // Same options the sidebar warms on hover, so a revisit (or a hovered
  // link) paints from cache; create/edit/delete invalidations refresh it.
  const { data, isLoading } = useQuery({
    ...dashCommunitiesQuery(org_id, accessToken),
    enabled: !!accessToken,
  })
  const all: Community[] = useMemo(() => (Array.isArray(data) ? data : []), [data])

  // Thread counts for every card in one call; null on API builds without it.
  const { data: activityList } = useOrgCommunityActivity(org_id, accessToken)
  const activityByUuid = useMemo(
    () => (activityList ? new Map(activityList.map((a) => [a.community_uuid, a])) : null),
    [activityList]
  )

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null)

  // ---- filters ----
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [visibility, setVisibility] = useState<VisibilityFilter>('all')
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [sort, setSort] = useStoredState<SortKey>('lh_dash_communities_sort', 'updated', SORT_KEYS)
  const [view, setView] = useStoredState<'grid' | 'list'>('lh_dash_communities_view', 'grid', VIEW_MODES)

  const stats = useMemo(
    () => ({
      total: all.length,
      public: all.filter((c) => c.public).length,
      private: all.filter((c) => !c.public).length,
      linked: all.filter((c) => !!c.course_id).length,
    }),
    [all]
  )

  const filtered = useMemo(() => {
    let list = all
    if (visibility === 'public') list = list.filter((c) => c.public)
    if (visibility === 'private') list = list.filter((c) => !c.public)
    if (linkedOnly) list = list.filter((c) => !!c.course_id)
    if (deferredSearch.trim()) list = list.filter((c) => searchMatchesAny([c.name, c.description], deferredSearch))
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }))
    else if (sort === 'newest') sorted.sort((a, b) => timeOf(b.creation_date) - timeOf(a.creation_date))
    else {
      // "Recent activity": newest thread or reply when known.
      const lastOf = (c: Community) =>
        Math.max(timeOf(activityByUuid?.get(c.community_uuid)?.last_activity_date ?? undefined), timeOf(c.update_date))
      sorted.sort((a, b) => lastOf(b) - lastOf(a))
    }
    return sorted
  }, [all, visibility, linkedOnly, deferredSearch, sort, i18n.language, activityByUuid])

  const hasActiveFilters = !!search || visibility !== 'all' || linkedOnly
  const clearFilters = () => {
    setSearch('')
    setVisibility('all')
    setLinkedOnly(false)
  }

  // Optimistic: the card leaves the list at once and comes back on failure.
  const removeCommunity = async (community: Community) => {
    const previous = queryClient.getQueryData<Community[]>(listKey)
    queryClient.setQueryData<Community[]>(listKey, (old) =>
      (Array.isArray(old) ? old : []).filter((c) => c.community_uuid !== community.community_uuid)
    )
    try {
      await deleteCommunity(community.community_uuid, accessToken)
      toast.success(t('dashboard.courses.communities.toasts.delete_success'))
      revalidateTags(['communities'], orgslug)
      queryClient.removeQueries({ queryKey: queryKeys.community.detail(community.community_uuid) })
    } catch {
      queryClient.setQueryData(listKey, previous)
      toast.error(t('dashboard.courses.communities.toasts.delete_error'))
    } finally {
      queryClient.invalidateQueries({ queryKey: listKey })
      queryClient.invalidateQueries({ queryKey: dashCommunityKeys.orgActivity(org_id) })
    }
  }

  const loading = isLoading && all.length === 0

  const newButton = (
    <Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={() => setIsCreateModalOpen(true)}>
      {t('dashboard.courses.communities.new_community')}
    </Button>
  )

  const itemProps = (community: Community) => ({
    community,
    activity: activityByUuid ? (activityByUuid.get(community.community_uuid) ?? null) : null,
    orgslug,
    orgId: org_id,
    orgUuid: org?.org_uuid,
    onEdit: () => setEditingCommunity(community),
    onDelete: () => removeCommunity(community),
  })

  return (
    <FeatureGate feature="communities" orgslug={orgslug} context="dashboard">
      {/* Hovering a row warms its editor route, so opening it is instant. */}
      <div {...rowPrefetch} className="px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0">
        <DashPageHeader
          breadcrumbs={[
            { label: t('dashboard.courses.communities.title'), href: '/dash/communities', icon: <Garage size={14} /> },
          ]}
          title={t('dashboard.courses.communities.title')}
          subtitle={t('communities.dash.subtitle')}
          actions={
            <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="communities" orgId={org_id}>
              {newButton}
            </AuthenticatedClientElement>
          }
        />

        {/* Stats double as quick filters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Garage size={16} />}
            iconClass="bg-neutral-100 text-neutral-600"
            label={t('communities.dash.stats.total')}
            value={loading ? null : stats.total}
            active={!hasActiveFilters}
            onClick={clearFilters}
          />
          <StatCard
            icon={<Globe size={16} />}
            iconClass="bg-sky-50 text-sky-600"
            label={t('communities.dash.stats.public')}
            value={loading ? null : stats.public}
            active={visibility === 'public'}
            onClick={() => setVisibility(visibility === 'public' ? 'all' : 'public')}
          />
          <StatCard
            icon={<Lock size={16} />}
            iconClass="bg-violet-50 text-violet-600"
            label={t('communities.dash.stats.private')}
            value={loading ? null : stats.private}
            active={visibility === 'private'}
            onClick={() => setVisibility(visibility === 'private' ? 'all' : 'private')}
          />
          <StatCard
            icon={<BookOpen size={16} />}
            iconClass="bg-emerald-50 text-emerald-600"
            label={t('communities.dash.stats.linked')}
            value={loading ? null : stats.linked}
            active={linkedOnly}
            onClick={() => setLinkedOnly(!linkedOnly)}
          />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('communities.dash.search_placeholder')}
            className="xl:max-w-md"
          />
          <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
            <SegmentedControl<VisibilityFilter>
              value={visibility}
              onChange={setVisibility}
              ariaLabel={t('communities.dash.visibility_filter')}
              options={[
                { key: 'all', label: t('communities.dash.filters.all') },
                { key: 'public', label: t('communities.public') },
                { key: 'private', label: t('communities.private') },
              ]}
            />
            <ToolbarSelect
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              ariaLabel={t('communities.dash.sort.label')}
              icon={<ArrowsDownUp size={14} />}
              options={[
                { value: 'updated', label: t('communities.dash.sort.activity') },
                { value: 'newest', label: t('communities.dash.sort.newest') },
                { value: 'name', label: t('communities.dash.sort.name') },
              ]}
            />
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        {!loading && all.length > 0 && (
          <div className="flex items-center justify-between gap-3 -mt-1 text-xs text-neutral-500">
            <span className="tabular-nums">
              {t('communities.dash.showing_count', { shown: filtered.length, total: all.length })}
            </span>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="font-semibold text-neutral-700 hover:text-neutral-900">
                {t('communities.dash.clear_filters')}
              </button>
            )}
          </div>
        )}

        {loading ? (
          view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <CommunityCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <CommunityRowSkeleton key={i} />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl nice-shadow">
            {hasActiveFilters ? (
              <EmptyState
                icon={<Tray size={22} />}
                title={t('communities.dash.empty_filtered')}
                description={t('communities.dash.empty_filtered_description')}
                action={
                  <Button size="sm" onClick={clearFilters}>
                    {t('communities.dash.clear_filters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Garage size={22} />}
                title={t('dashboard.courses.communities.no_communities')}
                description={t('dashboard.courses.communities.no_communities_description')}
                action={
                  <AuthenticatedClientElement checkMethod="roles" action="create" ressourceType="communities" orgId={org_id}>
                    <div className="mt-1">{newButton}</div>
                  </AuthenticatedClientElement>
                }
              />
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((community) => (
              <CommunityCard key={community.community_uuid} {...itemProps(community)} />
            ))}
          </div>
        ) : (
          <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${COMMUNITY_TABLE_GRID}`}>
            <div className={`hidden ${COMMUNITY_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('communities.dash.columns.community')}</span>
              <span>{t('communities.dash.columns.visibility')}</span>
              <span>{t('communities.dash.columns.threads')}</span>
              <span>{t('communities.dash.columns.activity')}</span>
              <span className="sr-only">{t('communities.actions.community_actions')}</span>
            </div>
            <ul className={`divide-y divide-neutral-100 ${COMMUNITY_ROW_GRID}`}>
              {filtered.map((community) => (
                <CommunityRow key={community.community_uuid} {...itemProps(community)} />
              ))}
            </ul>
          </div>
        )}
      </div>

      <CreateCommunityModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        orgId={org_id}
        orgSlug={orgslug}
      />

      {editingCommunity && (
        <EditCommunityModal
          isOpen={!!editingCommunity}
          onClose={() => setEditingCommunity(null)}
          community={editingCommunity}
          orgSlug={orgslug}
        />
      )}
    </FeatureGate>
  )
}

export default CommunitiesDashClient
