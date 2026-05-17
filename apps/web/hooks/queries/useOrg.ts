'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrganizationContextInfo } from '@services/organizations/orgs'

export function useOrg(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.org.detail(orgSlug),
    queryFn: () => getOrganizationContextInfo(orgSlug, {}, accessToken),
    enabled: !!orgSlug,
    staleTime: 5 * 60_000,
  })
}
