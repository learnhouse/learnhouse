'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { useSession } from 'next-auth/react'
import type React from 'react'
import { createContext, useContext } from 'react'

export const SessionContext = createContext({}) as any

function LHSessionProvider({ children }: { children: React.ReactNode }) {
  const session = useSession()

  if (session && session.status == 'loading') {
    return <PageLoading />
  } else if (session) {
    return (
      <SessionContext.Provider value={session}>
        {children}
      </SessionContext.Provider>
    )
  }
}

export function useLHSession() {
  return useContext(SessionContext)
}

export default LHSessionProvider
