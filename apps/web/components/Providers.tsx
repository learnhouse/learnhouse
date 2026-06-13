'use client'
import React, { useEffect, useState } from 'react'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import I18nProvider from '@components/Contexts/I18nContext'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  // OG_THEME: the PSP host posts Capital-token CSS into this iframe. We write
  // it into a single managed <style> tag. Additive only — no effect when the
  // app runs standalone (no host posts the message).
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'OG_THEME' || typeof e.data.css !== 'string') return
      let style = document.getElementById('og-theme-override') as HTMLStyleElement | null
      if (!style) {
        style = document.createElement('style')
        style.id = 'og-theme-override'
        document.head.appendChild(style)
      }
      style.textContent = e.data.css
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider refetchInterval={600000}>
        <LHSessionProvider>
          <I18nProvider>{children}</I18nProvider>
        </LHSessionProvider>
      </SessionProvider>
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
