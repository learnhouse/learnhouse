'use client'
import AdminShell from '@components/Admin/Shell/AdminShell'
import SuperadminAuthorization from '@components/Security/SuperadminAuthorization'
import React from 'react'

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SuperadminAuthorization>
      <AdminShell>{children}</AdminShell>
    </SuperadminAuthorization>
  )
}
