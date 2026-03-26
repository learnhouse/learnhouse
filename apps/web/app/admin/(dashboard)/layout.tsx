'use client'
import AdminTopMenu from '@components/Admin/AdminLeftMenu'
import SuperadminAuthorization from '@components/Security/SuperadminAuthorization'
import React from 'react'

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SuperadminAuthorization>
      <div className="min-h-screen bg-[#0f0f10]">
        <AdminTopMenu />
        <main>{children}</main>
      </div>
    </SuperadminAuthorization>
  )
}
