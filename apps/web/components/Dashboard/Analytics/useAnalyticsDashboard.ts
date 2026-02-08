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
    refreshInterval,
    revalidateOnFocus: false,
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
    refreshInterval,
    revalidateOnFocus: false,
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

  return useSWR(url, (u) => fetcher(u, token), { revalidateOnFocus: false })
}

export function usePlanInfo() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const url = orgId && token ? `${getAPIUrl()}analytics/plan-info?org_id=${orgId}` : null

  return useSWR(url, (u) => fetcher(u, token), { revalidateOnFocus: false })
}

export function useAnalyticsStatus() {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token

  const url = token ? `${getAPIUrl()}analytics/status` : null

  return useSWR(url, (u) => fetcher(u, token), { revalidateOnFocus: false })
}
