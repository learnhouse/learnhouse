import React from 'react'
import type { Metadata } from 'next'
import UserList from '@components/Admin/UserList'

export const metadata: Metadata = {
  title: 'Users',
}

export default function AdminUsersPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-white/40 mt-1">
          Manage all users across the platform
        </p>
      </div>
      <UserList />
    </div>
  )
}
