'use client'
import React, { useEffect, useState } from 'react'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import I18nProvider from '@components/Contexts/I18nContext'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

const DEFAULT_OG_THEME = `
:root {
  --primary-color: #1466d6;
  --surface-color: #ffffff;
  --text-color: #1a1a1a;
  --font-family-base: 'Inter', system-ui, -apple-system, sans-serif;
}
body { font-family: var(--font-family-base); color: var(--text-color); }
nav[aria-label="Top navigation"] ul li svg { display: none !important; }
nav[aria-label="Dashboard sidebar navigation"] {
  width: 240px !important;
  min-width: 240px !important;
}
`.trim()

function applyThemeCss(css: string) {
  let style = document.getElementById('og-theme-override') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'og-theme-override'
    document.head.appendChild(style)
  }
  style.textContent = css
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  useEffect(() => {
    // Apply Capital branding immediately so it's visible standalone too.
    // The PSP shell overrides it via postMessage when running embedded.
    applyThemeCss(DEFAULT_OG_THEME)

    const allowedOrigin = process.env.NEXT_PUBLIC_PSP_SHELL_ORIGIN || ''
    const handler = (e: MessageEvent) => {
      if (allowedOrigin && e.origin !== allowedOrigin) return
      if (e.data?.type !== 'OG_THEME' || typeof e.data.css !== 'string') return
      applyThemeCss(e.data.css)
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
