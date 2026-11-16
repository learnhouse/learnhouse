import type { ReactNode } from 'react'
import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgLanguageSync from '@components/Contexts/OrgLanguageSync'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import DemoInstanceBar from '@ee/components/DemoInstance/DemoInstanceBar'

export default async function AuthLayout({
    children,
}: {
    children: ReactNode
}) {
    const orgslug = await getAuthOrgSlug()

    // No org slug → bare apex (learn.io) → generic, org-less auth pages. No
    // OrgProvider; the page renders generic LearnHouse branding.
    // DemoInstanceBar: on a demo instance (EE) that has ended, the sign-in
    // pages hand over to /demo-ended; elsewhere it renders nothing.
    if (!orgslug) {
        return <>{children}<DemoInstanceBar /></>
    }

    return (
        <OrgProvider orgslug={orgslug}>
            <OrgLanguageSync />
            {children}
            <DemoInstanceBar />
        </OrgProvider>
    )
}
