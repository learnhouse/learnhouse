'use client'
import useSWR from 'swr'
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

const SWR_DEFAULTS = {
  revalidateOnFocus: false,
  dedupingInterval: 60000,
}

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
  const url = orgId && token ? `${getAPIUrl()}analytics/dashboard/${pipeName}?${params}` : null

  return useSWR(url, (u) => fetcher(u, token), {
    ...SWR_DEFAULTS,
    refreshInterval,
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
  const url = orgId && token ? `${getAPIUrl()}analytics/dashboard/detail/${queryName}?${params}` : null

  return useSWR(url, (u) => fetcher(u, token), {
    ...SWR_DEFAULTS,
    refreshInterval,
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
  const url = orgId && token ? `${getAPIUrl()}analytics/dashboard/db/${queryName}?${params}` : null

  return useSWR(url, (u) => fetcher(u, token), SWR_DEFAULTS)
}

export function usePlanInfo() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const url = orgId && token ? `${getAPIUrl()}analytics/plan-info?org_id=${orgId}` : null

  return useSWR(url, (u) => fetcher(u, token), SWR_DEFAULTS)
}

export function useAnalyticsStatus() {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token

  const url = token ? `${getAPIUrl()}analytics/status` : null

  return useSWR(url, (u) => fetcher(u, token), SWR_DEFAULTS)
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
  const url =
    orgId && token && courseUuid
      ? `${getAPIUrl()}analytics/dashboard/course/${pipeName}?${params}`
      : null

  return useSWR(url, (u) => fetcher(u, token), {
    ...SWR_DEFAULTS,
    refreshInterval,
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
  const url =
    orgId && token && courseUuid
      ? `${getAPIUrl()}analytics/dashboard/course/detail/${queryName}?${params}`
      : null

  return useSWR(url, (u) => fetcher(u, token), {
    ...SWR_DEFAULTS,
    refreshInterval,
  })
}
