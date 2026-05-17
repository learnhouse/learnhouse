'use client'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'

function fetcher(url: string, token: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })
}

const STALE_TIME = 60_000

export function useAnalyticsPipe(
  pipeName: string,
  extraParams: Record<string, string> = {},
  refreshInterval = 0
) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const params = new URLSearchParams({ org_id: String(orgId ?? ''), ...extraParams })
  const paramsStr = params.toString()

  return useQuery({
    queryKey: queryKeys.analytics.pipe(orgId ?? 0, pipeName, paramsStr),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/dashboard/${pipeName}?${paramsStr}`, token),
    enabled: !!(orgId && token),
    staleTime: STALE_TIME,
    refetchInterval: refreshInterval || false,
  })
}

export function useAnalyticsDetail(
  queryName: string,
  extraParams: Record<string, string> = {},
  refreshInterval = 0
) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const params = new URLSearchParams({ org_id: String(orgId ?? ''), ...extraParams })
  const paramsStr = params.toString()

  return useQuery({
    queryKey: queryKeys.analytics.detail(orgId ?? 0, queryName, paramsStr),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/dashboard/detail/${queryName}?${paramsStr}`, token),
    enabled: !!(orgId && token),
    staleTime: STALE_TIME,
    refetchInterval: refreshInterval || false,
  })
}

export function useAnalyticsDbQuery(
  queryName: string,
  extraParams: Record<string, string> = {}
) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const params = new URLSearchParams({ org_id: String(orgId ?? ''), ...extraParams })
  const paramsStr = params.toString()

  return useQuery({
    queryKey: queryKeys.analytics.db(orgId ?? 0, queryName, paramsStr),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/dashboard/db/${queryName}?${paramsStr}`, token),
    enabled: !!(orgId && token),
    staleTime: STALE_TIME,
  })
}

export function usePlanInfo() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  return useQuery({
    queryKey: queryKeys.analytics.planInfo(orgId ?? 0),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/plan-info?org_id=${orgId}`, token),
    enabled: !!(orgId && token),
    staleTime: STALE_TIME,
  })
}

export function useAnalyticsStatus() {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token

  return useQuery({
    queryKey: queryKeys.analytics.status(),
    queryFn: () => fetcher(`${getAPIUrl()}analytics/status`, token),
    enabled: !!token,
    staleTime: STALE_TIME,
  })
}

export function useCoursePipe(
  pipeName: string,
  courseUuid: string,
  extraParams: Record<string, string> = {},
  refreshInterval = 0
) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const params = new URLSearchParams({
    org_id: String(orgId ?? ''),
    course_uuid: courseUuid,
    ...extraParams,
  })
  const paramsStr = params.toString()

  return useQuery({
    queryKey: queryKeys.analytics.coursePipe(orgId ?? 0, courseUuid, pipeName, paramsStr),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/dashboard/course/${pipeName}?${paramsStr}`, token),
    enabled: !!(orgId && token && courseUuid),
    staleTime: STALE_TIME,
    refetchInterval: refreshInterval || false,
  })
}

export function useCourseAnalyticsDetail(
  queryName: string,
  courseUuid: string,
  extraParams: Record<string, string> = {},
  refreshInterval = 0
) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const params = new URLSearchParams({
    org_id: String(orgId ?? ''),
    course_uuid: courseUuid,
    ...extraParams,
  })
  const paramsStr = params.toString()

  return useQuery({
    queryKey: queryKeys.analytics.courseDetail(orgId ?? 0, courseUuid, queryName, paramsStr),
    queryFn: () =>
      fetcher(`${getAPIUrl()}analytics/dashboard/course/detail/${queryName}?${paramsStr}`, token),
    enabled: !!(orgId && token && courseUuid),
    staleTime: STALE_TIME,
    refetchInterval: refreshInterval || false,
  })
}
