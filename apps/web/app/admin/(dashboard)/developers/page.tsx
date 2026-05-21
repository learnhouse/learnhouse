import React from 'react'
import type { Metadata } from 'next'
import DevelopersTabs from '@components/Admin/Developers/DevelopersTabs'

export const metadata: Metadata = {
  title: 'Developers',
}

export default function AdminDevelopersPage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Developers</h1>
        <p className="text-white/40 mt-1">
          API tokens, endpoint reference, and a live playground for cross-org automation.
        </p>
      </div>
      <DevelopersTabs />
    </div>
  )
}
