'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useMemo } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ErrorUI from '@components/Objects/StyledElements/Error/Error'

interface OrgContextValue {
  org: any
  isUserPartOfTheOrg: boolean
  orgslug: string
}

export const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({ children, orgslug }: { children: React.ReactNode, orgslug: string }) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: org, error: orgError } = useSWR(
    `${getAPIUrl()}orgs/slug/${orgslug}`,
    (url) => swrFetcher(url, accessToken),
    {
      revalidateOnFocus: true,
      revalidateOnMount: true,
      dedupingInterval: 5000,
    }
  )
  const { data: orgs, error: orgsError } = useSWR(
    `${getAPIUrl()}orgs/user/page/1/limit/10`,
    (url) => swrFetcher(url, accessToken),
    {
      revalidateOnFocus: true,
      revalidateOnMount: true,
      dedupingInterval: 5000,
    }
  )

  const isOrgActive = useMemo(() => org?.config?.config?.general?.enabled !== false, [org])
  const isUserPartOfTheOrg = useMemo(() => {
    // If user is not authenticated, treat them as "part of org" for viewing purposes
    if (session.status !== 'authenticated') return true
    return orgs?.some((userOrg: any) => userOrg.id === org?.id) ?? false
  }, [orgs, org?.id, session.status])

  if (orgError || orgsError) return <ErrorUI message='An error occurred while fetching data' />
  if (!org || !orgs || !session) return <div></div>
  if (!isOrgActive) return <ErrorUI message='This organization is no longer active' />

  const contextValue: OrgContextValue = {
    org,
    isUserPartOfTheOrg,
    orgslug,
  }

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
