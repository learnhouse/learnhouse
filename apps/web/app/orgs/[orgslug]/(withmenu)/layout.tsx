'use client'
import '@styles/globals.css'
import { Menu } from '@components/Objects/Menu/Menu'
import { SessionProvider } from 'next-auth/react'
import Watermark from '@components/Watermark'

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
        <Menu orgslug={params?.orgslug}></Menu>
        {children}
        <Watermark />
      </SessionProvider>
    </>
  )
}
