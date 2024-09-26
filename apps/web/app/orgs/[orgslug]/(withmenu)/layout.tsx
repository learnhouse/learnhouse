'use client'
import '@styles/globals.css'
import { SessionProvider } from 'next-auth/react'
import Watermark from '@components/Watermark'
import { OrgMenu } from '@components/Objects/Menus/OrgMenu/OrgMenu'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: any
}) {
  return (
    <>
      <SessionProvider>
        <OrgMenu orgslug={params?.orgslug}></OrgMenu>
        {children}
        <Watermark />
      </SessionProvider>
    </>
  )
}
