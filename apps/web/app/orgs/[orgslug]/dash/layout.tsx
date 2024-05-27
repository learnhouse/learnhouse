import LeftMenu from '@components/Dashboard/UI/LeftMenu'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import ClientComponentSkeleton from '@components/Utils/ClientComp'
import { Metadata } from 'next'
import { SessionProvider } from 'next-auth/react'
import React from 'react'
import ClientAdminLayout from './ClientAdminLayout'

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
      <ClientAdminLayout
        params={params}>
        {children}
      </ClientAdminLayout>
    </>
  )
}

export default DashboardLayout
