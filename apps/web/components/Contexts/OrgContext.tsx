'use client'
import { getAPIUrl, getUriWithoutOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useMemo } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ErrorUI from '@components/StyledElements/Error/Error'
import InfoUI from '@components/StyledElements/Info/Info'
import { usePathname } from 'next/navigation'

export const OrgContext = createContext(null)

export function OrgProvider({ children, orgslug }: { children: React.ReactNode, orgslug: string }) {
  const session = useLHSession() as any
  const pathname = usePathname()
  const accessToken = session?.data?.tokens?.access_token
  const isAllowedPathname = ['/login', '/signup'].includes(pathname);

  const { data: org, error: orgError } = useSWR(
    `${getAPIUrl()}orgs/slug/${orgslug}`,
    (url) => swrFetcher(url, accessToken)
  )
  const { data: orgs, error: orgsError } = useSWR(
    `${getAPIUrl()}orgs/user/page/1/limit/10`,
    (url) => swrFetcher(url, accessToken)
  )


  const isOrgActive = useMemo(() => org?.config?.config?.general?.enabled !== false, [org])
  const isUserPartOfTheOrg = useMemo(() => orgs?.some((userOrg: any) => userOrg.id === org?.id), [orgs, org?.id])

  if (orgError || orgsError) return <ErrorUI message='An error occurred while fetching data' />
  if (!org || !orgs || !session) return <div></div>
  if (!isOrgActive) return <ErrorUI message='This organization is no longer active' />
  if (!isUserPartOfTheOrg && session.status == 'authenticated' && !isAllowedPathname) {
    return (
      <InfoUI
        href={getUriWithoutOrg(`/signup?orgslug=${orgslug}`)}
        message='You are not part of this Organization yet'
        cta={`Join ${org?.name}`}
      />
    )
  }

  return <OrgContext.Provider value={org}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
