import type { Metadata } from 'next'
import type React from 'react'
import ClientAdminLayout from './ClientAdminLayout'

export const metadata: Metadata = {
  title: 'LearnHouse Dashboard',
}

async function DashboardLayout(props: {
  children: React.ReactNode
  params: Promise<any>
}) {
  const params = await props.params

  const { children } = props

  return (
    <>
      <ClientAdminLayout params={params}>{children}</ClientAdminLayout>
    </>
  )
}

export default DashboardLayout
