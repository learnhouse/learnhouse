'use client'
import { getAPIUrl, getUriWithoutOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useMemo } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ErrorUI from '@components/Objects/StyledElements/Error/Error'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { LogOut, PersonStanding, Home } from 'lucide-react'

export const OrgContext = createContext(null)

export function OrgProvider({ children, orgslug }: { children: React.ReactNode, orgslug: string }) {
  const session = useLHSession() as any
  const pathname = usePathname()
  const accessToken = session?.data?.tokens?.access_token
  const isAllowedPathname = ['/login', '/signup'].includes(pathname);

  const handleSignOut = async () => {
    await signOut({ 
      redirect: true, 
      callbackUrl: getUriWithoutOrg('/login?orgslug=' + orgslug) 
    })
  }

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
      <div className="flex flex-col py-10 mx-auto antialiased items-center space-y-6 bg-linear-to-b from-yellow-100 to-yellow-100/5 ">
        <div className="flex flex-row items-center space-x-5 rounded-xl ">
          <div className="text-yellow-700">
            <PersonStanding size={45} />
          </div>
          <div className='flex flex-col'>
            <p className="text-3xl font-bold text-yellow-700">You are not part of this Organization yet</p>
          </div>
        </div>
        <div className='flex space-x-4'>
          <a
            href={getUriWithoutOrg(`/signup?orgslug=${orgslug}`)}
            className="flex space-x-2 items-center rounded-full px-4 py-1 text-yellow-200 bg-yellow-700 hover:bg-yellow-800 transition-all ease-linear shadow-lg "
          >
            <PersonStanding className="text-yellow-200" size={17} />
            <span className="text-md font-bold">Join {org?.name}</span>
          </a>
          <a
            href={getUriWithoutOrg('/home')}
            className="flex space-x-2 items-center rounded-full px-4 py-1 text-gray-200 bg-gray-700 hover:bg-gray-800 transition-all ease-linear shadow-lg "
          >
            <Home className="text-gray-200" size={17} />
            <span className="text-md font-bold">Home</span>
          </a>
          <button
            onClick={handleSignOut}
            className="flex space-x-2 items-center rounded-full px-4 py-1 text-red-200 bg-red-700 hover:bg-red-800 transition-all ease-linear shadow-lg "
          >
            <LogOut className="text-red-200" size={17} />
            <span className="text-md font-bold">Sign Out</span>
          </button>
        </div>
      </div>
    )
  }

  return <OrgContext.Provider value={org}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
