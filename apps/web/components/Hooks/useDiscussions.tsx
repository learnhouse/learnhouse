'use client'
import { getAPIUrl } from '@services/config/config'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  DiscussionWithAuthor,
  DiscussionSortBy,
  getDiscussions,
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
  const { communityUuid, sortBy = 'recent', page = 1, limit = 10, label } = options
  const queryClient = useQueryClient()

  const queryKey = [
    ...queryKeys.community.discussions(communityUuid, sortBy, page),
    limit,
    label ?? null,
  ]

  const { data, error, isLoading, isFetching } = useQuery<DiscussionWithAuthor[]>({
    queryKey,
    queryFn: () => getDiscussions(communityUuid, sortBy, page, limit, null, access_token, label ?? undefined),
    enabled: !!communityUuid && !!access_token,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const mutate = (
    updater: (current: DiscussionWithAuthor[] | undefined) => DiscussionWithAuthor[] | undefined,
  ) => {
    queryClient.setQueryData<DiscussionWithAuthor[]>(queryKey, updater)
  }

  return {
    discussions: data || [],
    error,
    isLoading,
    isValidating: isFetching,
    mutate,
  }
}

/**
 * Invalidate discussions cache for a specific community.
 * Call this after creating/updating/deleting a discussion.
 */
export function useMutateDiscussions() {
  const queryClient = useQueryClient()
  return (communityUuid: string) => {
    queryClient.invalidateQueries({
      queryKey: ['community', communityUuid, 'discussions'],
    })
  }
}
