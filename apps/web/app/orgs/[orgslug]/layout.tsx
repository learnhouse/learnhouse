'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import NextTopLoader from 'nextjs-toploader'
import { use } from 'react'
import '@styles/globals.css'
import Onboarding from '@components/Objects/Onboarding/Onboarding'

export default function RootLayout(props: {
  children: React.ReactNode
  params: Promise<any>
}) {
  const params = use(props.params)

  const { children } = props

  return (
    <div>
      <OrgProvider orgslug={params.orgslug}>
        <NextTopLoader
          color="#2e2e2e"
          initialPosition={0.3}
          height={4}
          easing={'ease'}
          speed={500}
          showSpinner={false}
        />
        <Toast />
        <Onboarding />
        {children}
      </OrgProvider>
    </div>
  )
}
