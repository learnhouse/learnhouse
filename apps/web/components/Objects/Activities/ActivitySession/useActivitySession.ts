'use client'

// Data for an activity session outside the lesson page, read with the
// viewer's own session: the org (its id keys the trail), the course tree,
// the trail (progress) and, once the session is open, the activity itself.
// Every query shares its cache key with the lesson page, so marking the
// activity complete here shows up there and the other way round.

import { useContext, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import { getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { OrgContext } from '@components/Contexts/OrgContext'
import { useTrail } from '@/hooks/queries/useTrail'
import { coursePath } from '@/lib/seo/paths'
import {
  activityKind,
  activityProgress,
  cleanActivityUuid,
  cleanCourseUuid,
  courseCompleted,
  findCourseActivity,
  fullActivityUuid,
  wasOpened,
  type ActivityKind,
  type ActivityProgress,
} from './activityTypes'

/**
 * ok: the viewer can take the activity. signin: no session. forbidden: no
 * access to the course (private, group-restricted, not enrolled). paid: behind
 * an offer. restricted: the activity or its chapter is locked to a user group.
 * drip: not released yet. draft: unpublished. missing: deleted or moved.
 */
export type SessionAccess = 'loading' | 'ok' | 'signin' | 'forbidden' | 'paid' | 'restricted' | 'drip' | 'draft' | 'missing' | 'error'

const noopSubscribe = () => () => {}

const statusOf = (err: unknown): number | undefined => (err as { status?: number } | null)?.status

function accessFromError(err: unknown): SessionAccess {
  switch (statusOf(err)) {
    case 401:
      return 'signin'
    case 402:
      return 'paid'
    case 403:
      return 'forbidden'
    case 404:
      return 'missing'
    default:
      return 'error'
  }
}

/** 4xx answers are final; only retry network and server errors. */
const retryTransient = (count: number, err: unknown) => {
  const s = statusOf(err)
  return !(s && s >= 400 && s < 500) && count < 2
}

export function useSessionToken(fallback?: string): string | undefined {
  const session = useLHSession() as any
  return (session?.data?.tokens?.access_token as string | undefined) || fallback
}

/** The org: from the surrounding OrgContext when there is one, else fetched by slug (same cache key). */
export function useSessionOrg(orgslug: string, token?: string) {
  const outer = useContext(OrgContext)
  const { data } = useQuery({
    queryKey: queryKeys.org.detail(orgslug),
    queryFn: () => getOrganizationContextInfo(orgslug, null, token),
    enabled: !outer?.org && !!orgslug,
    staleTime: 5 * 60_000,
  })
  return (outer?.org ?? data ?? null) as any
}

async function fetchActivity(uuid: string, token?: string) {
  const res = await fetch(`${getAPIUrl()}activities/${fullActivityUuid(uuid)}`, RequestBodyWithAuthHeader('GET', null, null, token))
  return errorHandling(res)
}

export interface ActivitySummary {
  access: SessionAccess
  /** The course tree (slim), null while loading or without access. */
  course: any | null
  /** The activity's entry in the course tree. */
  entry: any | null
  kind: ActivityKind
  progress: ActivityProgress | null
  courseDone: boolean
  courseHref: string
  activityHref: string
  endHref: string
  thumbnail: string
  org: any
  trail: any
}

/**
 * Cheap read for a card: course tree + trail, no activity content. Enough for
 * the title, kind, cover, lock state and the viewer's progress.
 */
export function useActivitySummary({
  activityUuid,
  courseUuid,
  orgslug,
  token: tokenProp,
  enabled = true,
}: {
  activityUuid: string
  courseUuid: string
  orgslug: string
  token?: string
  enabled?: boolean
}): ActivitySummary {
  const token = useSessionToken(tokenProp)
  const org = useSessionOrg(orgslug, token)
  const cCourse = cleanCourseUuid(courseUuid || '')
  const course = useQuery({
    queryKey: queryKeys.courses.meta(cCourse),
    queryFn: () => getCourseMetadata(cCourse, {}, token, { slim: true }),
    enabled: enabled && !!cCourse && !!token,
    staleTime: 60_000,
    retry: retryTransient,
  })
  const trail = useTrail(enabled ? org?.id : undefined)

  // localStorage isn't there during SSR: the server snapshot says "not opened".
  const opened = useSyncExternalStore(
    noopSubscribe,
    () => (activityUuid ? wasOpened(activityUuid) : false),
    () => false,
  )

  return useMemo(() => {
    const c = course.data && typeof course.data === 'object' && (course.data as any).course_uuid ? (course.data as any) : null
    const entry = c ? findCourseActivity(c, activityUuid) : null
    let access: SessionAccess = 'loading'
    if (!cCourse || !activityUuid) access = 'missing'
    else if (course.error) access = accessFromError(course.error)
    else if (c) access = !entry ? 'missing' : entry.is_locked ? (entry.drip_reason ? 'drip' : 'restricted') : 'ok'
    const key = c ? coursePath({ slug: c.slug, course_uuid: c.course_uuid }) : `/course/${cCourse}`
    const orgUuid = c?.org_uuid || org?.org_uuid
    return {
      access,
      course: c,
      entry,
      kind: activityKind(entry?.activity_type, entry?.activity_sub_type),
      progress: c && entry && trail.data ? activityProgress(trail.data, c.course_uuid, entry.id, opened) : null,
      courseDone: !!(c && trail.data && courseCompleted(trail.data, c)),
      courseHref: getUriWithOrg(orgslug, key),
      activityHref: getUriWithOrg(orgslug, `/course/${cCourse}/activity/${cleanActivityUuid(activityUuid)}`),
      endHref: getUriWithOrg(orgslug, `/course/${cCourse}/activity/end`),
      thumbnail: c?.thumbnail_image && orgUuid ? getCourseThumbnailMediaDirectory(orgUuid, c.course_uuid, c.thumbnail_image) : '',
      org,
      trail: trail.data ?? null,
    }
  }, [course.data, course.error, trail.data, activityUuid, cCourse, orgslug, org, opened])
}

/** The activity itself (content), for an open session. */
export function useSessionActivity(activityUuid: string, token?: string, enabled = true) {
  const clean = cleanActivityUuid(activityUuid || '')
  const q = useQuery({
    queryKey: queryKeys.activity.detail(clean),
    queryFn: () => fetchActivity(clean, token),
    enabled: enabled && !!clean && !!token,
    staleTime: 60_000,
    retry: retryTransient,
  })
  // The lesson page's fetcher caches an error body under the same key; only a
  // real activity counts.
  const activity = q.data && typeof q.data === 'object' && (q.data as any).activity_uuid ? (q.data as any) : null
  let access: SessionAccess = 'loading'
  if (q.error) access = accessFromError(q.error)
  else if (q.data && !activity) access = 'error'
  else if (activity) {
    if (activity.is_locked) access = activity.drip_reason ? 'drip' : 'restricted'
    else if (activity.published === false) access = 'draft'
    else if (activity.content?.paid_access === false) access = 'paid'
    else access = 'ok'
  }
  return { activity, access, refetch: q.refetch }
}
