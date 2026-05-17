'use client'
import React, { createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { Podcast, PodcastEpisode, PodcastMeta, getPodcastMeta } from '@services/podcasts/podcasts'
import { useLHSession } from './LHSessionContext'

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
  const queryClient = useQueryClient()

  const { data, error, isLoading } = useQuery<PodcastMeta>({
    queryKey: queryKeys.podcasts.meta(podcastuuid),
    queryFn: () => getPodcastMeta(podcastuuid, null, access_token),
    enabled: !!(podcastuuid && access_token),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })

  const podcast = data?.podcast || null
  const episodes = data?.episodes || []

  const refreshPodcast = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.meta(podcastuuid) })
  }

  const setPodcast = (newPodcast: Podcast | null) => {
    if (data) {
      queryClient.setQueryData<PodcastMeta>(
        queryKeys.podcasts.meta(podcastuuid),
        { ...data, podcast: newPodcast! }
      )
    }
  }

  const setEpisodes = (newEpisodes: PodcastEpisode[]) => {
    if (data) {
      queryClient.setQueryData<PodcastMeta>(
        queryKeys.podcasts.meta(podcastuuid),
        { ...data, episodes: newEpisodes }
      )
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
