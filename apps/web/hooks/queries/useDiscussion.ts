'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  getDiscussions,
  getDiscussion,
  getComments,
  getReactions,
  type DiscussionSortBy,
} from '@services/communities/discussions'

export function useDiscussions(
  communityUuid: string,
  sort: DiscussionSortBy = 'recent',
  page = 1
) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.community.discussions(communityUuid, sort, page),
    queryFn: () => getDiscussions(communityUuid, sort, page, 10, {}, accessToken),
    enabled: !!communityUuid,
    staleTime: 30_000,
  })
}

export function useDiscussion(discussionUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.discussion.detail(discussionUuid),
    queryFn: () => getDiscussion(discussionUuid, {}, accessToken),
    enabled: !!discussionUuid,
    staleTime: 30_000,
  })
}

export function useDiscussionComments(discussionUuid: string, page = 1) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.discussion.comments(discussionUuid, page),
    queryFn: () => getComments(discussionUuid, page, 50, {}, accessToken),
    enabled: !!discussionUuid,
    staleTime: 30_000,
  })
}

export function useDiscussionReactions(discussionUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.discussion.reactions(discussionUuid),
    queryFn: () => getReactions(discussionUuid, accessToken),
    enabled: !!discussionUuid,
    staleTime: 30_000,
  })
}
