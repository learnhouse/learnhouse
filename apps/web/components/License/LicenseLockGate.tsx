'use client'
import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LICENSE_LOCKED_EVENT, isLicenseLockExemptPage } from '@/lib/license/lock'
import LicenseLockedScreen from './LicenseLockedScreen'

/**
 * Swaps the app for the lock screen once an API call answers 423
 * `license_locked` (AuthFetchInterceptor raises the event). The proxy already
 * serves the lock screen on page loads; this covers a tab that was open when
 * the license lapsed, and the window where the proxy's cached instance info
 * is still fresh. The login page is left alone, as on the server.
 */
export default function LicenseLockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false)
  const pathname = usePathname() || '/'

  useEffect(() => {
    const onLocked = () => setLocked(true)
    window.addEventListener(LICENSE_LOCKED_EVENT, onLocked)
    return () => window.removeEventListener(LICENSE_LOCKED_EVENT, onLocked)
  }, [])

  if (locked && !isLicenseLockExemptPage(pathname)) return <LicenseLockedScreen />
  return <>{children}</>
}
