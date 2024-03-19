import SessionProvider from '@components/Contexts/SessionContext'
import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'LearnHouse Dashboard',
}

function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: any
}) {
  return (
    <>
      <SessionProvider>
        <AdminAuthorization authorizationMode="page">
          <div className="flex">
            <LeftMenu />
            <div className="flex w-full">{children}</div>
          </div>
        </AdminAuthorization>
      </SessionProvider>
    </>
  )
}

export default DashboardLayout
