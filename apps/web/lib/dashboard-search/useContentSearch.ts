'use client'
import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useDebounce } from '@/hooks/useDebounce'
import { searchOrgContent } from '@services/search/search'

export type ContentResultType =
  | 'course'
  | 'collection'
  | 'user'
  | 'community'
  | 'discussion'
  | 'playground'
  | 'podcast'

export interface ContentResult {
  id: string
  type: ContentResultType
  title: string
  subtitle?: string
  href: string
}

const stripPrefix = (uuid: string, prefix: string) =>
  uuid?.startsWith(prefix) ? uuid.slice(prefix.length) : uuid

function normalize(data: any): ContentResult[] {
  if (!data) return []
  const out: ContentResult[] = []

  for (const c of data.courses ?? []) {
    out.push({
      id: c.course_uuid,
      type: 'course',
      title: c.name,
      subtitle: c.description ?? undefined,
      href: `/dash/courses/course/${stripPrefix(c.course_uuid, 'course_')}/general`,
    })
  }
  for (const col of data.collections ?? []) {
    out.push({
      id: col.collection_uuid,
      type: 'collection',
      title: col.name,
      subtitle: col.description ?? undefined,
      href: `/dash/courses?collection=${stripPrefix(col.collection_uuid, 'collection_')}`,
    })
  }
  for (const u of data.users ?? []) {
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
    out.push({
      id: u.user_uuid,
      type: 'user',
      title: fullName || u.username,
      subtitle: u.username ? `@${u.username}` : undefined,
      href: '/dash/users/settings/users',
    })
  }
  for (const com of data.communities ?? []) {
    out.push({
      id: com.community_uuid,
      type: 'community',
      title: com.name,
      subtitle: com.description ?? undefined,
      href: `/dash/communities/${stripPrefix(com.community_uuid, 'community_')}/general`,
    })
  }
  for (const d of data.discussions ?? []) {
    const community = stripPrefix(d.community_uuid ?? '', 'community_')
    out.push({
      id: d.discussion_uuid ?? `${d.id}`,
      type: 'discussion',
      title: d.title ?? d.content?.slice(0, 80) ?? '',
      subtitle: d.content ? d.content.slice(0, 100) : undefined,
      href: community ? `/dash/communities/${community}/discussions` : '/dash/communities',
    })
  }
  for (const p of data.playgrounds ?? []) {
    out.push({
      id: p.playground_uuid,
      type: 'playground',
      title: p.name,
      subtitle: p.description ?? undefined,
      href: '/dash/playgrounds',
    })
  }
  for (const p of data.podcasts ?? []) {
    out.push({
      id: p.podcast_uuid,
      type: 'podcast',
      title: p.name,
      subtitle: p.description ?? undefined,
      href: `/dash/podcasts/podcast/${stripPrefix(p.podcast_uuid, 'podcast_')}/general`,
    })
  }
  return out
}

export function useContentSearch(query: string) {
  const debounced = useDebounce(query, 250)
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { orgslug } = useOrgMembership()

  const trimmed = debounced.trim()
  const enabled = trimmed.length >= 2 && !!orgslug

  const { data, error, isLoading } = useQuery({
    queryKey: ['dash-search', orgslug, trimmed, accessToken ?? null],
    queryFn: async () => {
      const res = await searchOrgContent(orgslug, trimmed, 1, 5, null, accessToken)
      return res?.success ? normalize(res.data) : []
    },
    enabled,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    staleTime: 1500,
  })

  return {
    results: (data ?? []) as ContentResult[],
    isLoading: enabled && isLoading,
    isWaiting: query.trim().length >= 2 && trimmed !== query.trim(),
    error,
    enabled,
  }
}
