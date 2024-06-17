'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import NextTopLoader from 'nextjs-toploader';
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
        <NextTopLoader color="#2e2e2e" initialPosition={0.3} height={4}  easing={'ease'} speed={500} showSpinner={false} />
        <Toast />
        {children}
      </OrgProvider>
    </div>
  )
}
