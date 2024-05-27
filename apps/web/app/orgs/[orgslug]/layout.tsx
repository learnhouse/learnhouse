'use client'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import { OrgProvider } from '@components/Contexts/OrgContext'
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
      <OrgProvider orgslug={params.orgslug}>
        <Toast />
        {children}
      </OrgProvider>
    </div>
  )
}
