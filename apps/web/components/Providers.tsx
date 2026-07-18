'use client'
import React, { useState } from 'react'
import '../lib/i18n'
import { ThemeProvider } from 'next-themes'
import ThemeToggle from '@components/Theme/ThemeToggle'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import AuthFetchInterceptor from '@components/Contexts/AuthFetchInterceptor'
import PostHogProvider from '@components/Contexts/PostHogProvider'
import I18nProvider from '@components/Contexts/I18nContext'
import { BackgroundTasksProvider } from '@components/Contexts/BackgroundTasksContext'
import BackgroundTasksPanel from '@components/BackgroundTasks/BackgroundTasksPanel'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <SessionProvider refetchInterval={600000}>
          <AuthFetchInterceptor />
          <LHSessionProvider>
            <PostHogProvider>
              <I18nProvider>
                <BackgroundTasksProvider>
                  {children}
                  <BackgroundTasksPanel />
                  <ThemeToggle />
                </BackgroundTasksProvider>
              </I18nProvider>
            </PostHogProvider>
          </LHSessionProvider>
        </SessionProvider>
      </ThemeProvider>
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
