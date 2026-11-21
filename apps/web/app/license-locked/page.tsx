import type { Metadata } from 'next'
import LicenseLockedScreen from '@components/License/LicenseLockedScreen'

// Only reached through the proxy, which rewrites every page here while the
// self-hosted license is locked (see lib/license/lock.ts). Visited directly
// on an unlocked platform, the path falls into the org catch-all and 404s.
export const metadata: Metadata = {
  title: 'LearnHouse',
  robots: { index: false, follow: false },
}

export default function LicenseLockedPage() {
  return <LicenseLockedScreen />
}
