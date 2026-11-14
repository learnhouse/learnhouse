'use client'

import React, { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ClockCounterClockwise, Headphones, MagnifyingGlass, Pause, Play, Plus, SquaresFour } from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import PodcastThumbnail from '@components/Objects/Thumbnails/PodcastThumbnail'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import dynamic from 'next/dynamic'
// Admin-only form behind a button: loaded on open, not in the page's first download.
const CreatePodcastModal = dynamic(() => import('@components/Objects/Modals/Podcast/Create/CreatePodcast'))
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Podcast, PodcastEpisode, PodcastWithEpisodeCount } from '@services/podcasts/podcasts'
import { useTranslation } from 'react-i18next'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Button, EmptyState, SearchInput, ToolbarSelect } from '@components/Dashboard/Shared/DashKit/DashKit'
import { searchMatchesAny } from '@/lib/search/normalize'
import { useTrackView, useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import CatalogPagination, { useCatalogPagination } from '@components/Objects/Catalog/CatalogPagination'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import { useOrg } from '@components/Contexts/OrgContext'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { type ListeningEntry, listenedFraction, useListening } from '@components/Objects/Podcasts/listeningProgress'
import { Equalizer, ListenBar, episodeCover, formatLength, parseApiDate } from '@components/Objects/Podcasts/podcastUi'

interface PodcastsClientProps {
  orgslug: string
  org_id: number
  initialPodcasts: PodcastWithEpisodeCount[]
}

type SortKey = 'updated' | 'newest' | 'name' | 'episodes'
// Square tiles are small, so a page holds more of them than the course grid.
const PAGE_SIZE = 18

const time = (value: string | null | undefined) => parseApiDate(value)?.getTime() ?? 0

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900 mb-3">
      <span className="w-6 h-6 rounded-lg bg-white nice-shadow text-neutral-600 flex items-center justify-center">{icon}</span>
      {title}
      {count !== undefined && (
        <span className="text-xs font-semibold tabular-nums text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">{count}</span>
      )}
    </h2>
  )
}

export default function PodcastsClient({
  orgslug,
  org_id,
  initialPodcasts,
}: PodcastsClientProps) {
  const { t } = useTranslation()
  const allPodcasts = useMemo(() => (Array.isArray(initialPodcasts) ? initialPodcasts : []), [initialPodcasts])
  const searchParams = useSearchParams()
  const isCreatingPodcast = searchParams.get('new') ? true : false
  const [newPodcastModal, setNewPodcastModal] = useState(isCreatingPodcast)
  const { isAdmin: isUserAdmin } = useAdminStatus()
  const listening = useListening()

  useTrackView(
    AnalyticsEvent.PodcastsListViewed,
    { total_podcasts_count: allPodcasts.length },
    true,
    'learner',
  )

  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')

  const filteredPodcasts = useMemo(() => {
    const list = searchQuery.trim()
      ? allPodcasts.filter((podcast) => searchMatchesAny([podcast.name, podcast.description, podcast.tags], searchQuery))
      : [...allPodcasts]
    return list.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sort === 'episodes') return (b.episode_count ?? 0) - (a.episode_count ?? 0)
      if (sort === 'newest') return time(b.creation_date) - time(a.creation_date)
      return time(b.update_date) - time(a.update_date)
    })
  }, [allPodcasts, searchQuery, sort])

  // Episodes left half-way in this browser, newest first, for podcasts still
  // in this catalog.
  const continuing = useMemo(() => {
    const byUuid = new Map(allPodcasts.map((p) => [p.podcast_uuid, p]))
    return Object.values(listening)
      .filter((l) => byUuid.has(l.podcast?.podcast_uuid))
      .filter((l) => listenedFraction(l) > 0.01 && listenedFraction(l) < 0.99)
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .map((entry) => ({ entry, podcast: byUuid.get(entry.podcast.podcast_uuid)! }))
  }, [listening, allPodcasts])

  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedPodcasts,
    pageNumbers,
    goToPage,
    resetPage,
  } = useCatalogPagination(filteredPodcasts, PAGE_SIZE)

  // Reset to page 1 when search changes
  React.useEffect(() => {
    resetPage()
  }, [searchQuery, sort, resetPage])

  async function closeNewPodcastModal() {
    setNewPodcastModal(false)
  }

  const createButton = (
    <Button variant="primary" size="md" icon={<Plus size={14} weight="bold" />}>
      {t('podcasts.new_podcast')}
    </Button>
  )

  return (
    <FeatureGate feature="podcasts" orgslug={orgslug} context="public">
    <div className="w-full">
      <GeneralWrapperStyled>
        <ListShortcuts
          onNextPage={() => goToPage(currentPage + 1)}
          onPrevPage={() => goToPage(currentPage - 1)}
          hasNextPage={currentPage < totalPages}
          hasPrevPage={currentPage > 1}
        />
        <div className="flex items-center justify-between gap-3">
          <TypeOfContentTitle title={t('podcasts.podcasts')} type="pod" />
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="podcasts"
            orgId={org_id}
          >
            <Modal
              isDialogOpen={newPodcastModal}
              onOpenChange={setNewPodcastModal}
              minHeight="md"
              minWidth="lg"
              dialogContent={
                <CreatePodcastModal
                  closeModal={closeNewPodcastModal}
                  orgslug={orgslug}
                />
              }
              dialogTitle={t('podcasts.create_podcast')}
              dialogDescription={t('podcasts.create_new_podcast')}
              dialogTrigger={createButton}
            />
          </AuthenticatedClientElement>
        </div>
        <p className="-mt-2 mb-5 text-sm text-neutral-500 max-w-2xl">{t('podcasts.browse_description')}</p>

        {allPodcasts.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-6">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('podcasts.search_placeholder')}
              className="sm:max-w-xs"
            />
            <div className="flex items-center gap-2 sm:ms-auto">
              {searchQuery.trim() && (
                <span className="text-xs text-neutral-500 tabular-nums">
                  {t('podcasts.search_results', { count: filteredPodcasts.length, query: searchQuery.trim() })}
                </span>
              )}
              <ToolbarSelect
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                ariaLabel={t('podcasts.dashboard.list.sort_label')}
                options={[
                  { value: 'updated', label: t('podcasts.dashboard.list.sort.updated') },
                  { value: 'newest', label: t('podcasts.dashboard.list.sort.newest') },
                  { value: 'name', label: t('podcasts.dashboard.list.sort.name') },
                  { value: 'episodes', label: t('podcasts.dashboard.list.sort.episodes') },
                ]}
              />
            </div>
          </div>
        )}

        {continuing.length > 0 && !searchQuery.trim() && currentPage === 1 && (
          <section className="mb-8">
            <SectionTitle icon={<ClockCounterClockwise size={14} />} title={t('podcasts.listen.continue_listening')} />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {continuing.map(({ entry, podcast }) => (
                <ContinueCard key={entry.episode.episode_uuid} entry={entry} podcast={podcast} />
              ))}
            </div>
          </section>
        )}

        {filteredPodcasts.length > 0 && (
          <section>
            {continuing.length > 0 && !searchQuery.trim() && currentPage === 1 && (
              <SectionTitle icon={<SquaresFour size={14} />} title={t('podcasts.listen.all_podcasts')} count={filteredPodcasts.length} />
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4">
              {paginatedPodcasts.map((podcast) => (
                <PodcastThumbnail key={podcast.podcast_uuid} podcast={podcast} orgslug={orgslug} />
              ))}
            </div>
          </section>
        )}

        {filteredPodcasts.length === 0 && searchQuery.trim() && (
          <EmptyState
            icon={<MagnifyingGlass size={22} />}
            title={t('podcasts.no_search_results')}
            description={t('podcasts.try_different_search')}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
                {t('podcasts.dashboard.list.clear_filters')}
              </Button>
            }
          />
        )}

        {allPodcasts.length === 0 && (
          <div className="bg-white rounded-2xl nice-shadow">
            <EmptyState
              icon={<Headphones size={22} />}
              title={t('podcasts.no_podcasts')}
              description={isUserAdmin ? t('podcasts.create_podcasts_placeholder') : t('podcasts.no_podcasts_description')}
              action={
                isUserAdmin ? (
                  <AuthenticatedClientElement
                    action="create"
                    ressourceType="podcasts"
                    checkMethod="roles"
                    orgId={org_id}
                  >
                    <Button variant="primary" size="md" icon={<Plus size={14} weight="bold" />} onClick={() => setNewPodcastModal(true)}>
                      {t('podcasts.new_podcast')}
                    </Button>
                  </AuthenticatedClientElement>
                ) : undefined
              }
            />
          </div>
        )}

        <CatalogPagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageNumbers={pageNumbers}
          onPageChange={goToPage}
          previousLabel={t('pagination.previous')}
          nextLabel={t('pagination.next')}
          className="mt-8"
        />

        {totalPages > 1 && (
          <div className="mt-2 text-center text-sm text-neutral-500">
            {t('pagination.showing_page', { current: currentPage, total: totalPages })}
          </div>
        )}
      </GeneralWrapperStyled>
    </div>
    </FeatureGate>
  )
}

/** An episode left half-way: cover, where it stands and a play button. */
function ContinueCard({ entry, podcast }: { entry: ListeningEntry; podcast: Podcast }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { state, playEpisode, togglePlay } = usePodcastPlayer()
  const { track } = useLHAnalytics('learner')
  const isCurrent = state.currentEpisode?.episode_uuid === entry.episode.episode_uuid
  const isPlaying = isCurrent && state.isPlaying
  const t0 = isCurrent ? state.currentTime : entry.t
  const length = (isCurrent && state.duration) || entry.d
  const fraction = length ? Math.min(1, t0 / length) : 0

  const onPlay = () => {
    if (isCurrent) {
      togglePlay()
      return
    }
    track(AnalyticsEvent.EpisodePlayed, {
      episode_number: entry.episode.episode_number,
      duration_seconds: entry.episode.duration_seconds,
    })
    // Only the fields the player reads were saved; it needs no more.
    playEpisode(entry.episode as PodcastEpisode, podcast)
  }

  return (
    <button
      type="button"
      onClick={onPlay}
      className={`group flex items-center gap-3 text-start bg-white rounded-2xl nice-shadow p-2.5 pe-4 min-w-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        isCurrent ? 'ring-1 ring-neutral-900/10' : ''
      }`}
    >
      <span className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-neutral-100 ring-1 ring-black/5">
        <ThumbnailImage src={episodeCover(org?.org_uuid, podcast, entry.episode)} alt="" className="w-full h-full" />
        <span
          className={`absolute inset-0 flex items-center justify-center bg-black/35 text-white transition-opacity ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          }`}
        >
          {isPlaying ? (
            <>
              <Equalizer className="group-hover:hidden" />
              <Pause size={20} weight="fill" className="hidden group-hover:block" />
            </>
          ) : (
            <Play size={20} weight="fill" className="rtl:-scale-x-100" />
          )}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">{entry.episode.title}</span>
        <span className="block text-xs text-neutral-500 truncate" dir="auto">{podcast.name}</span>
        <span className="mt-2 flex items-center gap-2">
          <ListenBar fraction={fraction} className="flex-1 max-w-40" />
          <span className="text-[11px] text-neutral-500 tabular-nums whitespace-nowrap">
            {t('podcasts.listen.time_left', { time: formatLength(Math.max(0, length - t0), t) })}
          </span>
        </span>
      </span>
    </button>
  )
}
