'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { useContext, useEffect } from 'react'
import useSWR from 'swr'
import { createContext } from 'react'
import { useRouter } from 'next/navigation'

export const OrgContext = createContext({}) as any

export function OrgProvider({
  children,
  orgslug,
}: {
  children: React.ReactNode
  orgslug: string
}) {
  const { data: org } = useSWR(`${getAPIUrl()}orgs/slug/${orgslug}`, swrFetcher)
  const router = useRouter()
  // Check if Org is Active 
  const verifyIfOrgIsActive = () => {
    if (org && org?.config.config.GeneralConfig.active === false) {
      router.push('/404')
    }

  }
  useEffect(() => {
    verifyIfOrgIsActive()
  }, [org])

  return <OrgContext.Provider value={org}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
