'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgPodcasts, getPodcast } from '@services/podcasts/podcasts'
import { getEpisodes } from '@services/podcasts/episodes'

export function usePodcasts(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.podcasts.list(orgSlug),
    queryFn: () => getOrgPodcasts(orgSlug, {}, accessToken),
    enabled: !!orgSlug,
    staleTime: 60_000,
  })
}

export function usePodcast(podcastUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.podcasts.detail(podcastUuid),
    queryFn: () => getPodcast(podcastUuid, {}, accessToken),
    enabled: !!podcastUuid,
    staleTime: 60_000,
  })
}

export function usePodcastEpisodes(podcastUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.podcasts.episodes(podcastUuid),
    queryFn: () => getEpisodes(podcastUuid, {}, accessToken),
    enabled: !!podcastUuid,
    staleTime: 60_000,
  })
}
