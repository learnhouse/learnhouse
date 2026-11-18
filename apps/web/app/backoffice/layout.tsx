import type { Metadata } from 'next'
import BackofficeProviders from './providers'
import React from 'react'
import { fetchInstanceMode, isBackofficeSurfaceBlocked } from '@lib/eeGate'
import EERequiredScreen from '@components/Security/EERequiredScreen'
import BackofficeTheme from '@ee/components/Backoffice/Shell/BackofficeTheme'

// The gate is resolved per request. An ISR-cached result would outlive a
// licence change, and this layout is what decides whether /backoffice exists.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    template: '%s | LearnHouse Backoffice',
    default: 'LearnHouse Backoffice',
  },
}

// LearnHouse Backoffice is Enterprise Edition. This shell wraps everything
// under /backoffice, including /backoffice/login, which sits outside the
// (dashboard) route group. On an OSS deployment it returns the screen and
// short-circuits BackofficeProviders, so no session is bootstrapped and no login
// form is rendered; community builds (no apps/web/ee) resolve the @ee imports
// below to ee-stub, which 404s.
export default async function BackofficeRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (isBackofficeSurfaceBlocked(await fetchInstanceMode())) {
    return <EERequiredScreen />
  }

  // The console follows the app-wide Light / Dark choice, painted before
  // first paint by theme-init.js (see BackofficeTheme).
  return (
    <BackofficeTheme>
      <BackofficeProviders>{children}</BackofficeProviders>
    </BackofficeTheme>
  )
}
