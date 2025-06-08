'use client'

import React from 'react'
import OrgScripts from '@/components/OrgScripts/OrgScripts'
import { usePathname } from 'next/navigation'
import { OrgProvider } from '@/components/Contexts/OrgContext'

const Footer: React.FC = () => {
  const pathname = usePathname()
  const isDashboard = pathname?.startsWith('/dashboard')

  // Don't run scripts in dashboard pages
  if (isDashboard) {
    return null
  }

  return <OrgScripts />
}

export default Footer 