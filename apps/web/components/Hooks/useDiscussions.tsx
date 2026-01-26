'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR, { mutate } from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  DiscussionWithAuthor,
  DiscussionSortBy,
} from '@services/communities/discussions'

export interface UseDiscussionsOptions {
  communityUuid: string
  sortBy?: DiscussionSortBy
  page?: number
  limit?: number
  label?: string | null
}

export function getDiscussionsKey(options: UseDiscussionsOptions) {
  const { communityUuid, sortBy = 'recent', page = 1, limit = 10, label } = options
  let url = `${getAPIUrl()}communities/${communityUuid}/discussions?sort_by=${sortBy}&page=${page}&limit=${limit}`
  if (label) {
    url += `&label=${label}`
  }
  return url
}

export function useDiscussions(options: UseDiscussionsOptions) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const key = options.communityUuid ? getDiscussionsKey(options) : null

  const { data, error, isLoading, isValidating, mutate: boundMutate } = useSWR<DiscussionWithAuthor[]>(
    key,
    (url: string) => swrFetcher(url, access_token),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  )

  return {
    discussions: data || [],
    error,
    isLoading,
    isValidating,
    mutate: boundMutate,
  }
}

/**
 * Mutate discussions cache for a specific community.
 * Call this after creating/updating/deleting a discussion.
 */
export function mutateDiscussions(communityUuid: string) {
  // Invalidate all discussions queries for this community
  mutate(
    (key) => typeof key === 'string' && key.includes(`/communities/${communityUuid}/discussions`),
    undefined,
    { revalidate: true }
  )
}
