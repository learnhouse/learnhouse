'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { useSession } from 'next-auth/react'
import type React from 'react'
import { createContext, use } from 'react'

export const SessionContext = createContext({}) as any

function LHSessionProvider({ children }: { children: React.ReactNode }) {
  const session = useSession()

  if (session && session.status == 'loading') {
    return <PageLoading />
  } else if (session) {
    return <SessionContext value={session}>{children}</SessionContext>
  }
}

export function useLHSession() {
  return use(SessionContext)
}

export default LHSessionProvider
