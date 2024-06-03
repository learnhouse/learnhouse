'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { useContext, useEffect, useState } from 'react'
import useSWR from 'swr'
import { createContext } from 'react'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ErrorUI from '@components/StyledElements/Error/Error'

export const OrgContext = createContext({}) as any

export function OrgProvider({
  children,
  orgslug,
}: {
  children: React.ReactNode
  orgslug: string
}) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const { data: org } = useSWR(`${getAPIUrl()}orgs/slug/${orgslug}`, (url) => swrFetcher(url, access_token))
  const [isLoading, setIsLoading] = useState(true);
  const [isOrgActive, setIsOrgActive] = useState(true);

  // Check if Org is Active 
  const verifyIfOrgIsActive = () => {
    if (org && org?.config.config.GeneralConfig.active === false) {
      setIsOrgActive(false)
    }
    else {
      setIsOrgActive(true)
    }
  }

  useEffect(() => {
    if (org && session) {
      verifyIfOrgIsActive()
      setIsLoading(false)
    }
  }, [org, session])

  if (!isLoading) {
    return <OrgContext.Provider value={org}>{children}</OrgContext.Provider>
  }
  if (!isOrgActive) {
    return <ErrorUI message='This organization is no longer active' />
  }
}

export function useOrg() {
  return useContext(OrgContext)
}
