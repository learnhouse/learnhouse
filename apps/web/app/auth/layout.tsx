import type { ReactNode } from 'react'
import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgLanguageSync from '@components/Contexts/OrgLanguageSync'
import { getAuthOrgSlug } from '@services/org/orgResolution'

export default async function AuthLayout({
    children,
}: {
    children: ReactNode
}) {
    const orgslug = await getAuthOrgSlug()

    // No org slug → bare apex (learn.io) → generic, org-less auth pages. No
    // OrgProvider; the page renders generic LearnHouse branding.
    if (!orgslug) {
        return <>{children}</>
    }

    return (
        <OrgProvider orgslug={orgslug}>
            <OrgLanguageSync />
            {children}
        </OrgProvider>
    )
}
