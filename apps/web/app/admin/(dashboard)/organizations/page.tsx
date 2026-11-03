import React from 'react'
import AdminPageHeader from '@components/Admin/AdminPageHeader'
import type { Metadata } from 'next'
import OrganizationList from '@components/Admin/OrganizationList'

export const metadata: Metadata = {
  title: 'Organizations',
}

export default function AdminOrganizationsPage() {
  return (
    <div className="p-8">
      <AdminPageHeader titleKey="admin.pages.organizations" descriptionKey="admin.pages.organizations_desc" className="mb-8" />
      <OrganizationList />
    </div>
  )
}
