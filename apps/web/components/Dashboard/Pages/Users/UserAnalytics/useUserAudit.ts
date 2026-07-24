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

/** Full per-student dossier: connections, progress, assignments, community, certs, behavior. */
export function useUserDossier(userId: number | null, days = 365) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  return useQuery({
    queryKey: queryKeys.audit.user(orgId ?? 0, userId ?? 0, days),
    queryFn: () =>
      fetcher(
        `${getAPIUrl()}audit/user/${userId}?org_id=${orgId}&days=${days}`,
        token
      ),
    enabled: !!(orgId && token && userId),
    staleTime: STALE_TIME,
  })
}

/** Lightweight summary rows for the user list + multi-select comparison. */
export function useUsersAuditSummary(userIds: number[], days = 365) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const idsParam = [...userIds].sort((a, b) => a - b).join(',')

  return useQuery({
    queryKey: queryKeys.audit.summary(orgId ?? 0, idsParam, days),
    queryFn: () =>
      fetcher(
        `${getAPIUrl()}audit/users/summary?org_id=${orgId}&user_ids=${idsParam}&days=${days}`,
        token
      ),
    enabled: !!(orgId && token && userIds.length > 0),
    staleTime: STALE_TIME,
  })
}
