'use client'
import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useDebounce } from '@/hooks/useDebounce'
import { searchOrgContent } from '@services/search/search'
import { useContentLanguage } from '@/hooks/useContentLanguage'
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
import { coursePath, resourcePath } from '@/lib/seo/paths'

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
  /** Longer text for the preview pane (a course's "about", a post's body). */
  description?: string
  /** People credited on it, e.g. a course's active authors. */
  people?: { key: string; src: string; label: string }[]
  /** Last update as the API sends it; the preview shows it as relative time. */
  updatedAt?: string
  /** Lessons only: the API activity type (TYPE_VIDEO…) and sub type. */
  activityType?: string
  activitySubType?: string
  /** Lessons only: where the lesson lives. */
  courseName?: string
  chapterName?: string
}

export interface SiteSearchData {
  results: SiteResult[]
  total: number
  /** Matches per type across every page, not just the ones returned. */
  totals: Record<SiteResultType, number>
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

const TOTAL_KEYS: Record<SiteResultType, string> = {
  course: 'total_courses',
  activity: 'total_activities',
  folder: 'total_folders',
  community: 'total_communities',
  discussion: 'total_discussions',
  playground: 'total_playgrounds',
  podcast: 'total_podcasts',
  user: 'total_users',
}

export function emptyTotals(): Record<SiteResultType, number> {
  return { course: 0, activity: 0, folder: 0, community: 0, discussion: 0, playground: 0, podcast: 0, user: 0 }
}

const asList = (value: unknown): any[] => (Array.isArray(value) ? value : [])

export function normalizeSiteResults(
  data: any,
  orgslug: string,
  orgUuid: string,
  lessonLocation: (_course: string, _chapter: string) => string,
): SiteSearchData {
  if (!data) return { results: [], total: 0, totals: emptyTotals() }
  const out: SiteResult[] = []
  const link = (path: string) => getUriWithOrg(orgslug, path)

  for (const c of asList(data.courses)) {
    out.push({
      id: c.course_uuid,
      type: 'course',
      title: c.name,
      subtitle: c.description || undefined,
      description: c.about || c.description || undefined,
      updatedAt: c.update_date || undefined,
      people: asList(c.authors)
        .filter((a: any) => a?.user && (!a.authorship_status || a.authorship_status === 'ACTIVE'))
        .map((a: any) => ({
          key: a.user.user_uuid,
          src: a.user.avatar_image
            ? safeImageSrc(getUserAvatarMediaDirectory(a.user.user_uuid, a.user.avatar_image)) ?? ''
            : '',
          label: [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username || '',
        })),
      href: link(coursePath(c)),
      imageUrl: c.thumbnail_image
        ? safeImageSrc(getCourseThumbnailMediaDirectory(orgUuid, c.course_uuid, c.thumbnail_image))
        : undefined,
    })
  }
  for (const a of asList(data.activities)) {
    const course = stripPrefix(a.course_uuid, 'course_')
    const activity = stripPrefix(a.activity_uuid, 'activity_')
    out.push({
      id: a.activity_uuid,
      type: 'activity',
      title: a.name,
      subtitle: a.chapter_name
        ? lessonLocation(a.course_name, a.chapter_name)
        : a.course_name,
      activityType: a.activity_type || undefined,
      activitySubType: a.activity_sub_type || undefined,
      courseName: a.course_name || undefined,
      chapterName: a.chapter_name || undefined,
      href: link(`/course/${course}/activity/${activity}`),
      imageUrl: a.course_thumbnail_image
        ? safeImageSrc(
            getCourseThumbnailMediaDirectory(orgUuid, a.course_uuid, a.course_thumbnail_image),
          )
        : undefined,
    })
  }
  for (const f of asList(data.folders)) {
    out.push({
      id: f.folder_uuid,
      type: 'folder',
      title: f.name,
      subtitle: f.description || undefined,
      href: link(resourcePath('folder', f)),
    })
  }
  for (const com of asList(data.communities)) {
    out.push({
      id: com.community_uuid,
      type: 'community',
      title: com.name,
      subtitle: com.description || undefined,
      updatedAt: com.update_date || undefined,
      href: link(resourcePath('community', com)),
      imageUrl: com.thumbnail_image
        ? safeImageSrc(
            getCommunityThumbnailMediaDirectory(orgUuid, com.community_uuid, com.thumbnail_image),
          )
        : undefined,
    })
  }
  for (const d of asList(data.discussions)) {
    const community = stripPrefix(d.community_uuid ?? '', 'community_')
    const discussion = stripPrefix(d.discussion_uuid, 'discussion_')
    const body = extractPreviewText(d.content) || undefined
    out.push({
      id: d.discussion_uuid,
      type: 'discussion',
      title: d.title,
      subtitle: body,
      description: body,
      updatedAt: d.update_date || d.creation_date || undefined,
      emoji: d.emoji || undefined,
      href: community
        ? link(`/community/${community}/discussion/${discussion}`)
        : link(`/discussion/${discussion}`),
    })
  }
  for (const p of asList(data.playgrounds)) {
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
  for (const p of asList(data.podcasts)) {
    out.push({
      id: p.podcast_uuid,
      type: 'podcast',
      title: p.name,
      subtitle: p.description || undefined,
      href: link(resourcePath('podcast', p)),
      imageUrl: p.thumbnail_image
        ? safeImageSrc(getPodcastThumbnailMediaDirectory(orgUuid, p.podcast_uuid, p.thumbnail_image))
        : undefined,
    })
  }
  for (const u of asList(data.users)) {
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

  const totals = emptyTotals()
  for (const type of SITE_RESULT_ORDER) {
    const returned = out.filter((r) => r.type === type).length
    totals[type] = Math.max(Number(data[TOTAL_KEYS[type]]) || 0, returned)
  }
  const total = SITE_RESULT_ORDER.reduce((sum, type) => sum + totals[type], 0)

  return { results: out, total: Math.max(total, out.length), totals }
}

const PER_TYPE = 4
/** The API refuses shorter queries; the palette shows the page list until then. */
export const MIN_QUERY = 3

/**
 * Debounced org-wide content search for the command palette. `perType`
 * raises the per-type cap (the palette asks for more once it is scoped to
 * one type); the default keeps the original query key.
 */
export function useSiteSearch(
  query: string,
  lessonLocation: (_course: string, _chapter: string) => string,
  options: { perType?: number } = {},
) {
  const perType = options.perType ?? PER_TYPE
  const debounced = useDebounce(query, 200)
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const orgslug: string = org?.slug ?? ''
  const orgUuid: string = org?.org_uuid ?? ''
  // Course names in the learner's content language (published translations).
  const { lang } = useContentLanguage()

  const trimmed = debounced.trim()
  const enabled = trimmed.length >= MIN_QUERY && !!orgslug

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey:
      perType === PER_TYPE
        ? ['site-search', orgslug, trimmed, accessToken ?? null, lang]
        : ['site-search', orgslug, trimmed, accessToken ?? null, lang, { perType }],
    queryFn: async (): Promise<SiteSearchData> => {
      const res = await searchOrgContent(orgslug, trimmed, 1, perType, null, accessToken, lang || undefined)
      return res?.success
        ? normalizeSiteResults(res.data, orgslug, orgUuid, lessonLocation)
        : { results: [], total: 0, totals: emptyTotals() }
    },
    enabled,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    staleTime: 2000,
  })

  return {
    results: data?.results ?? [],
    total: data?.total ?? 0,
    totals: data?.totals ?? emptyTotals(),
    /** The results on screen are a previous query's, kept while the new one loads. */
    isPlaceholder: isPlaceholderData,
    isLoading: enabled && (isLoading || isFetching),
    isWaiting: query.trim().length >= MIN_QUERY && trimmed !== query.trim(),
    enabled,
    error,
  }
}
