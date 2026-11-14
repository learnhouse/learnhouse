'use client'
import React, { useState } from 'react'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import ColorSchemeProvider from '@components/Contexts/ColorSchemeContext'
import AuthFetchInterceptor from '@components/Contexts/AuthFetchInterceptor'
import QueryCacheUserGuard from '@components/Contexts/QueryCacheUserGuard'
import PostHogProvider from '@components/Contexts/PostHogProvider'
import I18nProvider from '@components/Contexts/I18nContext'
import DirectionProvider from '@components/Contexts/DirectionProvider'
import { BackgroundTasksProvider } from '@components/Contexts/BackgroundTasksContext'
import BackgroundTasksPanel from '@components/BackgroundTasks/BackgroundTasksPanel'
import ImpersonationBanner from '@components/Impersonation/ImpersonationBanner'
import ImpersonationAutoEntry from '@components/Impersonation/ImpersonationAutoEntry'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider refetchInterval={600000}>
        <AuthFetchInterceptor />
        <LHSessionProvider>
          <QueryCacheUserGuard />
          <ColorSchemeProvider>
            <PostHogProvider>
              <I18nProvider>
                {/* Inside I18nProvider so it re-renders when the language changes. */}
                <DirectionProvider>
                  <BackgroundTasksProvider>
                    {children}
                    <BackgroundTasksPanel />
                    {/* Every page: who an impersonation is acting as. */}
                    <ImpersonationBanner />
                    {/* Staff opening an org they don't belong to go straight in, impersonating. */}
                    <ImpersonationAutoEntry />
                  </BackgroundTasksProvider>
                </DirectionProvider>
              </I18nProvider>
            </PostHogProvider>
          </ColorSchemeProvider>
        </LHSessionProvider>
      </SessionProvider>
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
