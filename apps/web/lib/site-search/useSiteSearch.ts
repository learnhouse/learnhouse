'use client'
import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useDebounce } from '@/hooks/useDebounce'
import { searchOrgContent } from '@services/search/search'
import { getUriWithOrg } from '@services/config/config'
import {
  getCourseThumbnailMediaDirectory,
  getUserAvatarMediaDirectory,
  getCommunityThumbnailMediaDirectory,
  getPlaygroundThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import { safeImageSrc } from '@services/security/url'
import { extractPreviewText } from '@/lib/site-search/preview'

export type SiteResultType =
  | 'course'
  | 'activity'
  | 'folder'
  | 'community'
  | 'discussion'
  | 'playground'
  | 'podcast'
  | 'user'

export interface SiteResult {
  id: string
  type: SiteResultType
  title: string
  subtitle?: string
  href: string
  /** Thumbnail or avatar; the palette falls back to the type icon without one. */
  imageUrl?: string
  /** Discussions carry their emoji in place of a thumbnail. */
  emoji?: string
  /** The initials-avatar key for members without a picture. */
  userId?: string
}

export interface SiteSearchData {
  results: SiteResult[]
  total: number
}

export const SITE_RESULT_ORDER: SiteResultType[] = [
  'course',
  'activity',
  'folder',
  'community',
  'discussion',
  'playground',
  'podcast',
  'user',
]

const stripPrefix = (uuid: string, prefix: string) =>
  uuid?.startsWith(prefix) ? uuid.slice(prefix.length) : uuid

export function normalizeSiteResults(
  data: any,
  orgslug: string,
  orgUuid: string,
  lessonLocation: (_course: string, _chapter: string) => string,
): SiteSearchData {
  if (!data) return { results: [], total: 0 }
  const out: SiteResult[] = []
  const link = (path: string) => getUriWithOrg(orgslug, path)

  for (const c of data.courses ?? []) {
    out.push({
      id: c.course_uuid,
      type: 'course',
      title: c.name,
      subtitle: c.description || undefined,
      href: link(`/course/${stripPrefix(c.course_uuid, 'course_')}`),
      imageUrl: c.thumbnail_image
        ? safeImageSrc(getCourseThumbnailMediaDirectory(orgUuid, c.course_uuid, c.thumbnail_image))
        : undefined,
    })
  }
  for (const a of data.activities ?? []) {
    const course = stripPrefix(a.course_uuid, 'course_')
    const activity = stripPrefix(a.activity_uuid, 'activity_')
    out.push({
      id: a.activity_uuid,
      type: 'activity',
      title: a.name,
      subtitle: a.chapter_name
        ? lessonLocation(a.course_name, a.chapter_name)
        : a.course_name,
      href: link(`/course/${course}/activity/${activity}`),
      imageUrl: a.course_thumbnail_image
        ? safeImageSrc(
            getCourseThumbnailMediaDirectory(orgUuid, a.course_uuid, a.course_thumbnail_image),
          )
        : undefined,
    })
  }
  for (const f of data.folders ?? []) {
    out.push({
      id: f.folder_uuid,
      type: 'folder',
      title: f.name,
      subtitle: f.description || undefined,
      href: link(`/library/folder/${stripPrefix(f.folder_uuid, 'folder_')}`),
    })
  }
  for (const com of data.communities ?? []) {
    out.push({
      id: com.community_uuid,
      type: 'community',
      title: com.name,
      subtitle: com.description || undefined,
      href: link(`/community/${stripPrefix(com.community_uuid, 'community_')}`),
      imageUrl: com.thumbnail_image
        ? safeImageSrc(
            getCommunityThumbnailMediaDirectory(orgUuid, com.community_uuid, com.thumbnail_image),
          )
        : undefined,
    })
  }
  for (const d of data.discussions ?? []) {
    const community = stripPrefix(d.community_uuid ?? '', 'community_')
    const discussion = stripPrefix(d.discussion_uuid, 'discussion_')
    out.push({
      id: d.discussion_uuid,
      type: 'discussion',
      title: d.title,
      subtitle: extractPreviewText(d.content) || undefined,
      emoji: d.emoji || undefined,
      href: community
        ? link(`/community/${community}/discussion/${discussion}`)
        : link(`/discussion/${discussion}`),
    })
  }
  for (const p of data.playgrounds ?? []) {
    out.push({
      id: p.playground_uuid,
      type: 'playground',
      title: p.name,
      subtitle: p.description || undefined,
      href: link(`/playground/${p.playground_uuid}`),
      imageUrl:
        p.thumbnail_image && p.org_uuid
          ? safeImageSrc(
              getPlaygroundThumbnailMediaDirectory(p.org_uuid, p.playground_uuid, p.thumbnail_image),
            )
          : undefined,
    })
  }
  for (const p of data.podcasts ?? []) {
    out.push({
      id: p.podcast_uuid,
      type: 'podcast',
      title: p.name,
      subtitle: p.description || undefined,
      href: link(`/podcast/${stripPrefix(p.podcast_uuid, 'podcast_')}`),
      imageUrl: p.thumbnail_image
        ? safeImageSrc(getPodcastThumbnailMediaDirectory(orgUuid, p.podcast_uuid, p.thumbnail_image))
        : undefined,
    })
  }
  for (const u of data.users ?? []) {
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
    out.push({
      id: u.user_uuid,
      type: 'user',
      title: fullName || u.username,
      subtitle: u.username ? `@${u.username}` : undefined,
      href: link(`/user/${encodeURIComponent(u.username)}`),
      imageUrl: u.avatar_image
        ? safeImageSrc(getUserAvatarMediaDirectory(u.user_uuid, u.avatar_image))
        : undefined,
      userId: u.id != null ? String(u.id) : undefined,
    })
  }

  const total = [
    'total_courses',
    'total_activities',
    'total_folders',
    'total_communities',
    'total_discussions',
    'total_playgrounds',
    'total_podcasts',
    'total_users',
  ].reduce((sum, key) => sum + (Number(data[key]) || 0), 0)

  return { results: out, total: Math.max(total, out.length) }
}

const PER_TYPE = 4
/** The API refuses shorter queries; the palette shows the page list until then. */
export const MIN_QUERY = 3

/** Debounced org-wide content search for the command palette. */
export function useSiteSearch(
  query: string,
  lessonLocation: (_course: string, _chapter: string) => string,
) {
  const debounced = useDebounce(query, 200)
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const orgslug: string = org?.slug ?? ''
  const orgUuid: string = org?.org_uuid ?? ''

  const trimmed = debounced.trim()
  const enabled = trimmed.length >= MIN_QUERY && !!orgslug

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['site-search', orgslug, trimmed, accessToken ?? null],
    queryFn: async () => {
      const res = await searchOrgContent(orgslug, trimmed, 1, PER_TYPE, null, accessToken)
      return res?.success
        ? normalizeSiteResults(res.data, orgslug, orgUuid, lessonLocation)
        : { results: [], total: 0 }
    },
    enabled,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    staleTime: 2000,
  })

  return {
    results: data?.results ?? [],
    total: data?.total ?? 0,
    isLoading: enabled && (isLoading || isFetching),
    isWaiting: query.trim().length >= MIN_QUERY && trimmed !== query.trim(),
    enabled,
    error,
  }
}
