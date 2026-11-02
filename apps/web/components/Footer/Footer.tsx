'use client'

import React from 'react'
import OrgScripts from '@/components/OrgScripts/OrgScripts'
import { usePathname } from 'next/navigation'

// allowOrgScripts comes from the server (lib/orgScripts): org scripts never run
// on a host that shares the platform session cookie.
const Footer: React.FC<{ allowOrgScripts: boolean }> = ({ allowOrgScripts }) => {
  const pathname = usePathname()
  // App/dashboard pages live under `/dash` on .io (org subdomains); the old
  // `/dashboard` prefix never matches here. Match both to be safe.
  const isDashboard = /(?:^|\/)dash(?:board)?(?:\/|$)/.test(pathname || '')

  // Don't run scripts in dashboard pages
  if (isDashboard || !allowOrgScripts) {
    return null
  }

  return <OrgScripts />
}

export default Footer
