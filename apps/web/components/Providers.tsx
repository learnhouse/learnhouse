'use client'
import React from 'react'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import I18nProvider from '@components/Contexts/I18nContext'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={600000}>
      <LHSessionProvider>
        <I18nProvider>{children}</I18nProvider>
      </LHSessionProvider>
    </SessionProvider>
  )
}
