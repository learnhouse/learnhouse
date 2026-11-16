'use client'
import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getDeploymentMode } from '@services/config/config'
import { getOrgTrial, type OrgTrial } from '@services/plans/trial'

/**
 * The org's free trial (SaaS), or null. Only fetched for people who manage
 * the org (`enabled`); the endpoint is admin-only and nobody else is shown
 * trial details.
 */
export function useOrgTrial(orgId: number | undefined, enabled: boolean): OrgTrial | null {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['org', orgId, 'trial'],
    queryFn: () => getOrgTrial(orgId!, token),
    enabled: enabled && !!orgId && !!token && getDeploymentMode() === 'saas',
    staleTime: 5 * 60_000,
    retry: false,
  })
  return data?.trial ?? null
}
