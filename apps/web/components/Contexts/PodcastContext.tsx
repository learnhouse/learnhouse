'use client'
import React, { createContext, useContext } from 'react'
import useSWR, { mutate } from 'swr'
import { Podcast, PodcastEpisode, PodcastMeta } from '@services/podcasts/podcasts'
import { useLHSession } from './LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'

interface PodcastContextType {
  podcast: Podcast | null
  episodes: PodcastEpisode[]
  isLoading: boolean
  error: string | null
  refreshPodcast: () => Promise<void>
  setPodcast: (podcast: Podcast | null) => void
  setEpisodes: (episodes: PodcastEpisode[]) => void
}

const PodcastContext = createContext<PodcastContextType | undefined>(undefined)

export function PodcastProvider({
  children,
  podcastuuid,
}: {
  children: React.ReactNode
  podcastuuid: string
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const swrKey = access_token ? `${getAPIUrl()}podcasts/${podcastuuid}/meta` : null

  const { data, error, isLoading, mutate: swrMutate } = useSWR<PodcastMeta>(
    swrKey,
    (url) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: 0, // No automatic refresh for dashboard
    }
  )

  const podcast = data?.podcast || null
  const episodes = data?.episodes || []

  const refreshPodcast = async () => {
    await swrMutate()
    // Also mutate the public podcast key to keep frontend in sync
    mutate((key) => typeof key === 'string' && key.includes('/podcasts/'), undefined, { revalidate: true })
  }

  const setPodcast = (newPodcast: Podcast | null) => {
    if (data) {
      swrMutate({ ...data, podcast: newPodcast! }, false)
    }
  }

  const setEpisodes = (newEpisodes: PodcastEpisode[]) => {
    if (data) {
      swrMutate({ ...data, episodes: newEpisodes }, false)
    }
  }

  return (
    <PodcastContext.Provider
      value={{
        podcast,
        episodes,
        isLoading,
        error: error ? 'Failed to load podcast' : null,
        refreshPodcast,
        setPodcast,
        setEpisodes,
      }}
    >
      {children}
    </PodcastContext.Provider>
  )
}

export function usePodcast() {
  const context = useContext(PodcastContext)
  if (context === undefined) {
    throw new Error('usePodcast must be used within a PodcastProvider')
  }
  return context
}
