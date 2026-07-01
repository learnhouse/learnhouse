'use client'
import React, { createContext, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ErrorUI from '@components/Objects/StyledElements/Error/Error'

interface OrgContextValue {
  org: any
  isUserPartOfTheOrg: boolean
  orgslug: string
}

export const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({
  children,
  orgslug,
}: {
  children: React.ReactNode
  orgslug: string
}) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: org, error: orgError, isLoading } = useQuery({
    queryKey: queryKeys.org.detail(orgslug),
    queryFn: () => getOrganizationContextInfo(orgslug, {}, accessToken),
    staleTime: 5 * 60_000,
    enabled: !!orgslug,
  })

  const isOrgActive = useMemo(() => (org?.config?.config?.active ?? org?.config?.config?.general?.enabled) !== false, [org])

  // Determine membership from session roles (available immediately, no extra API call).
  // Session roles contain ALL orgs the user belongs to — no pagination limit.
  const isUserPartOfTheOrg = useMemo(() => {
    if (session.status !== 'authenticated') return true
    if (!org?.id) return true // Don't show guest banner while org is loading

    // Check session roles
    const roles = session?.data?.roles
    if (roles && Array.isArray(roles)) {
      if (roles.some((r: any) => r.org?.id === org.id)) return true
    }

    // Superadmins are always part of every org
    if (session?.data?.user?.is_superadmin) return true

    return false
  }, [session?.data?.roles, session?.data?.user?.is_superadmin, org?.id, session.status])

  const contextValue = useMemo<OrgContextValue>(() => ({
    org,
    isUserPartOfTheOrg,
    orgslug,
  }), [org, isUserPartOfTheOrg, orgslug])

  // Pass the real SWR error so it's classified into a meaningful message
  // (offline / server / not-found …) with the right recovery actions, instead
  // of a flat "An error occurred while fetching data".
  if (orgError) return <ErrorUI error={orgError} />
  if (!isLoading && org && !isOrgActive) return (
    <ErrorUI
      message='This organization is no longer active'
      submessage="The workspace has been deactivated. If you believe this is a mistake, contact the organization's owner or our support team."
      resolutions={['home', 'signout', 'contact_support']}
    />
  )

  return <OrgContext.Provider value={contextValue}>{children}</OrgContext.Provider>
}

// Backward compatible hook - returns just the org object
export function useOrg() {
  const context = useContext(OrgContext)
  return context?.org ?? null
}

// New hook to get membership status
export function useOrgMembership() {
  const context = useContext(OrgContext)
  return {
    org: context?.org ?? null,
    isUserPartOfTheOrg: context?.isUserPartOfTheOrg ?? true,
    orgslug: context?.orgslug ?? '',
  }
}
