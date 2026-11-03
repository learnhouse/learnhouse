import React from 'react'
import AdminPageHeader from '@components/Admin/AdminPageHeader'
import type { Metadata } from 'next'
import UserList from '@components/Admin/UserList'

export const metadata: Metadata = {
  title: 'Users',
}

export default function AdminUsersPage() {
  return (
    <div className="p-8">
      <AdminPageHeader titleKey="admin.pages.users" descriptionKey="admin.pages.users_desc" className="mb-8" />
      <UserList />
    </div>
  )
}
