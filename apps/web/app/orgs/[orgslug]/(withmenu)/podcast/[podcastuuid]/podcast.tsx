'use client'

import React from 'react'
import useSWR from 'swr'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { PodcastSidebar } from '@components/Objects/Podcasts/PodcastSidebar'
import EpisodeCard from '@components/Objects/Podcasts/EpisodeCard'
import { Podcast, PodcastEpisode, PodcastMeta } from '@services/podcasts/podcasts'
import { Headphones, ListMusic, Loader2 } from 'lucide-react'
import { getUriWithOrg, getAPIUrl } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from 'usehooks-ts'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { swrFetcher } from '@services/utils/ts/requests'

interface PodcastClientProps {
  orgslug: string
  org_id: number
  podcastUuid: string
  initialPodcast: Podcast
  initialEpisodes: PodcastEpisode[]
}

export default function PodcastClient({
  orgslug,
  org_id,
  podcastUuid,
  initialPodcast,
  initialEpisodes,
}: PodcastClientProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const { state } = usePodcastPlayer()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // SWR key for fetching podcast meta
  const swrKey = `${getAPIUrl()}podcasts/${podcastUuid}/meta`

  // Use SWR for real-time updates
  const { data, error, isLoading, mutate } = useSWR<PodcastMeta>(
    swrKey,
    (url) => swrFetcher(url, access_token),
    {
      fallbackData: { podcast: initialPodcast, episodes: initialEpisodes },
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  )

  const podcast = data?.podcast || initialPodcast
  const episodes = data?.episodes || initialEpisodes

  // Add padding at bottom when player is visible
  const bottomPadding = state.isVisible ? (state.isMinimized ? 'pb-20' : 'pb-28') : ''

  if (error) {
    return (
      <GeneralWrapperStyled>
        <div className="flex items-center justify-center min-h-[50vh]">
          <p className="text-gray-500">Failed to load podcast</p>
        </div>
      </GeneralWrapperStyled>
    )
  }

  return (
    <GeneralWrapperStyled>
      <div className={bottomPadding}>
        {/* Breadcrumbs */}
        <div className="pb-4">
          <Breadcrumbs
            items={[
              {
                label: t('podcasts.podcasts'),
                href: getUriWithOrg(orgslug, '/podcasts'),
                icon: <Headphones size={14} />,
              },
              { label: podcast.name },
            ]}
          />
        </div>

        {/* Layout - Sidebar Left, Content Right */}
        <div className="flex flex-col md:flex-row gap-6 pt-2">
          {/* Left Sidebar - Podcast Info (Desktop only) */}
          <div className="hidden md:block w-full md:w-72 lg:w-80 flex-shrink-0">
            <div className="sticky top-24">
              <PodcastSidebar
                podcast={podcast}
                episodeCount={episodes.length}
                orgslug={orgslug}
              />
            </div>
          </div>

          {/* Main Content - Episodes Feed */}
          <div className="flex-1 min-w-0">
            {/* Mobile header */}
            <div className="md:hidden mb-4">
              <h1 className="text-xl font-bold text-gray-900">{podcast.name}</h1>
              {podcast.description && (
                <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                  {podcast.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                <Headphones size={16} />
                <span>
                  {episodes.length}{' '}
                  {episodes.length === 1 ? 'episode' : 'episodes'}
                </span>
              </div>
            </div>

            {/* Episodes List */}
            <div className="bg-white nice-shadow rounded-lg overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListMusic size={18} className="text-gray-500" />
                  <h2 className="font-semibold text-gray-900">{t('podcasts.episodes')}</h2>
                  <span className="text-sm text-gray-400">
                    ({episodes.length})
                  </span>
                </div>
                {isLoading && (
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                )}
              </div>

              {/* Episode list */}
              {episodes.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {episodes.map((episode) => (
                    <EpisodeCard
                      key={episode.episode_uuid}
                      episode={episode}
                      podcast={podcast}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Headphones size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500">{t('podcasts.no_episodes')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom padding for mobile action bar */}
        {isMobile && <div className="h-4" />}
      </div>
    </GeneralWrapperStyled>
  )
}
