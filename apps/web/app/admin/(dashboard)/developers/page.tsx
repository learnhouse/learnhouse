import React from 'react'
import AdminPageHeader from '@components/Admin/AdminPageHeader'
import type { Metadata } from 'next'
import DevelopersTabs from '@components/Admin/Developers/DevelopersTabs'

export const metadata: Metadata = {
  title: 'Developers',
}

export default function AdminDevelopersPage() {
  return (
    <div className="p-8">
      <AdminPageHeader titleKey="admin.pages.developers" descriptionKey="admin.pages.developers_desc" className="mb-6" />
      <DevelopersTabs />
    </div>
  )
}
