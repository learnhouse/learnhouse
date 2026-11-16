'use client'

import React, { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowsDownUp, Garage, Plus, Tray } from '@phosphor-icons/react'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import CommunityTile from '@components/Objects/Communities/CommunityTile'
import dynamic from 'next/dynamic'
// Admin-only form behind a button: loaded after the page, not in its first download.
const CreateCommunityModal = dynamic(
  () => import('@components/Objects/Modals/Communities/CreateCommunityModal').then((m) => m.CreateCommunityModal),
  { ssr: false }
)
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import { Community, getCommunitiesSummary } from '@services/communities/communities'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import {
  Button,
  EmptyState,
  SearchInput,
  SegmentedControl,
  ToolbarSelect,
  useStoredState,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { searchMatchesAny } from '@/lib/search/normalize'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

interface CommunitiesClientProps {
  communities: Community[]
  orgslug: string
  org_id: number
}

type Scope = 'all' | 'course' | 'active'
type SortKey = 'active' | 'newest' | 'name'
const SORT_KEYS = ['active', 'newest', 'name'] as const

const timeOf = (value?: string | null) => {
  const time = value ? new Date(value).getTime() : NaN
  return isNaN(time) ? 0 : time
}

const CommunitiesClient = ({ communities, orgslug, org_id }: CommunitiesClientProps) => {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  useTrackView(AnalyticsEvent.CommunitiesListViewed, {
    communities_count: communities.length,
  })

  // Counts for every visible community in one call. Fails soft: the tiles
  // then just leave the numbers out.
  const { data: summaries, isError } = useQuery({
    queryKey: ['communities', org_id, 'summary', !!accessToken],
    queryFn: () => getCommunitiesSummary(org_id, accessToken),
    enabled: session?.status !== 'loading',
    staleTime: 60_000,
    retry: false,
  })
  const summaryOf = useMemo(() => {
    const map = new Map((summaries ?? []).map((s) => [s.community_uuid, s]))
    return (uuid: string) => (isError ? null : summaries ? (map.get(uuid) ?? null) : undefined)
  }, [summaries, isError])

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useStoredState<SortKey>('lh_communities_sort', 'active', SORT_KEYS)

  const hasCourseCommunities = communities.some((c) => !!c.course_id)

  const filtered = useMemo(() => {
    let list = communities
    if (scope === 'course') list = list.filter((c) => !!c.course_id)
    if (scope === 'active') list = list.filter((c) => (summaryOf(c.community_uuid)?.new_discussions_week ?? 0) > 0)
    if (deferredSearch.trim()) list = list.filter((c) => searchMatchesAny([c.name, c.description], deferredSearch))
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }))
    else if (sort === 'newest') sorted.sort((a, b) => timeOf(b.creation_date) - timeOf(a.creation_date))
    else
      sorted.sort(
        (a, b) =>
          timeOf(summaryOf(b.community_uuid)?.last_activity_date ?? b.update_date) -
          timeOf(summaryOf(a.community_uuid)?.last_activity_date ?? a.update_date)
      )
    return sorted
  }, [communities, scope, deferredSearch, sort, summaryOf, i18n.language])

  const hasFilters = !!search || scope !== 'all'
  const clearFilters = () => {
    setSearch('')
    setScope('all')
  }

  const newButton = (
    <AuthenticatedClientElement ressourceType="communities" action="create" checkMethod="roles" orgId={org_id}>
      <Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={() => setIsCreateModalOpen(true)}>
        {t('communities.new_community')}
      </Button>
    </AuthenticatedClientElement>
  )

  return (
    <FeatureGate feature="communities" orgslug={orgslug} context="public">
      <GeneralWrapperStyled>
        <ListShortcuts />
        <div className="flex flex-col gap-5">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-1">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-white nice-shadow text-neutral-700 flex items-center justify-center shrink-0">
                <Garage size={20} weight="duotone" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">{t('communities.title')}</h1>
                <p className="mt-0.5 text-sm text-neutral-500">{t('communities.learner.subtitle')}</p>
              </div>
            </div>
            {newButton}
          </header>

          {communities.length > 0 && (
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t('communities.learner.search_communities')}
                className="lg:max-w-md"
              />
              <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
                <SegmentedControl<Scope>
                  value={scope}
                  onChange={setScope}
                  ariaLabel={t('communities.learner.filter_label')}
                  options={[
                    { key: 'all', label: t('communities.learner.filters.all'), count: communities.length },
                    ...(hasCourseCommunities ? [{ key: 'course' as Scope, label: t('communities.learner.filters.course') }] : []),
                    ...(summaries ? [{ key: 'active' as Scope, label: t('communities.learner.filters.active') }] : []),
                  ]}
                />
                <ToolbarSelect
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  ariaLabel={t('communities.learner.sort.label')}
                  icon={<ArrowsDownUp size={14} />}
                  options={[
                    { value: 'active', label: t('communities.learner.sort.active') },
                    { value: 'newest', label: t('communities.learner.sort.newest') },
                    { value: 'name', label: t('communities.learner.sort.name') },
                  ]}
                />
              </div>
            </div>
          )}

          {communities.length === 0 ? (
            <div className="bg-white rounded-2xl nice-shadow">
              <EmptyState
                icon={<Garage size={22} />}
                title={t('communities.no_communities')}
                description={undefined}
                action={
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-sm text-neutral-500 max-w-sm text-center">
                      <ContentPlaceHolderIfUserIsNotAdmin text={t('communities.no_communities_description')} />
                    </div>
                    {newButton}
                  </div>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl nice-shadow">
              <EmptyState
                icon={<Tray size={22} />}
                title={t('communities.learner.no_match')}
                description={t('communities.learner.no_match_description')}
                action={
                  hasFilters ? (
                    <Button size="sm" onClick={clearFilters}>
                      {t('communities.learner.clear_filters')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((community, i) => (
                <CommunityTile
                  key={community.community_uuid}
                  community={community}
                  summary={summaryOf(community.community_uuid)}
                  orgslug={orgslug}
                  orgUuid={org?.org_uuid}
                  priority={i < 4}
                />
              ))}
            </div>
          )}
        </div>

        <CreateCommunityModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          orgId={org_id}
          orgSlug={orgslug}
        />
      </GeneralWrapperStyled>
    </FeatureGate>
  )
}

export default CommunitiesClient
