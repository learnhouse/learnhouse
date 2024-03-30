'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import SessionProvider from '@components/Contexts/SessionContext'
import Toast from '@components/StyledElements/Toast/Toast'
import '@styles/globals.css'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: any
}) {
  return (
    <div>
      <Toast />
      <OrgProvider orgslug={params.orgslug}>
        <SessionProvider>{children}</SessionProvider>
      </OrgProvider>
    </div>
  )
}
