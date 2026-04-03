'use client'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider, { SessionGate } from '@components/Contexts/LHSessionContext'
import React from 'react'

export default function AdminProviders({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      <LHSessionProvider>
        <SessionGate>
          {children}
        </SessionGate>
      </LHSessionProvider>
    </SessionProvider>
  )
}
