import SessionProvider from '@components/Contexts/SessionContext'
import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import React from 'react'

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
