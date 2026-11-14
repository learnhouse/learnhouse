'use client'
import { useQuery } from '@tanstack/react-query'
import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getDiscussions, type DiscussionWithAuthor } from '@services/communities/discussions'

// Dashboard-only reads for the communities area. They live here rather than
// in services/communities so the learner-facing services stay untouched.

export type DiscussionActivity = {
  discussion_uuid: string
  comment_count: number
  last_comment_date: string | null
}

export type CommunityActivity = {
  community_uuid: string
  discussion_count: number
  unanswered_count: number
  last_activity_date: string | null
}

export const dashCommunityKeys = {
  discussions: (communityUuid: string) => ['community', communityUuid, 'dash-discussions'] as const,
  discussionActivity: (communityUuid: string) => ['community', communityUuid, 'dash-discussion-activity'] as const,
  orgActivity: (orgId: number) => ['communities', orgId, 'dash-activity'] as const,
}

// Older API builds lack the activity endpoints: resolve to null so the UI
// simply hides counts instead of erroring.
async function getOptional<T>(url: string, accessToken?: string): Promise<T | null> {
  try {
    const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, accessToken))
    if (!res.ok) return null
    const body = await res.json()
    return Array.isArray(body) ? (body as T) : null
  } catch {
    return null
  }
}

const PAGE = 100
const MAX_PAGES = 5

// Every thread of a community (up to 500), pinned ones included. The list
// endpoint returns pinned threads first on page one, then the rest by date.
export async function getAllDiscussions(communityUuid: string, accessToken?: string) {
  const seen = new Set<string>()
  const all: DiscussionWithAuthor[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getDiscussions(communityUuid, 'recent', page, PAGE, null, accessToken)
    if (!Array.isArray(batch) || batch.length === 0) break
    let fresh = 0
    for (const d of batch) {
      if (seen.has(d.discussion_uuid)) continue
      seen.add(d.discussion_uuid)
      all.push(d)
      fresh++
    }
    if (batch.length < PAGE || fresh === 0) break
  }
  return all
}

export function useDiscussionActivity(communityUuid: string | undefined, accessToken?: string) {
  return useQuery({
    queryKey: dashCommunityKeys.discussionActivity(communityUuid ?? ''),
    queryFn: () =>
      getOptional<DiscussionActivity[]>(
        `${getAPIUrl()}communities/${communityUuid}/discussions/activity`,
        accessToken
      ),
    enabled: !!communityUuid && !!accessToken,
    staleTime: 30_000,
  })
}

export function useOrgCommunityActivity(orgId: number | undefined, accessToken?: string) {
  return useQuery({
    queryKey: dashCommunityKeys.orgActivity(orgId ?? 0),
    queryFn: () => getOptional<CommunityActivity[]>(`${getAPIUrl()}communities/org/${orgId}/activity`, accessToken),
    enabled: !!orgId && !!accessToken,
    staleTime: 30_000,
  })
}
