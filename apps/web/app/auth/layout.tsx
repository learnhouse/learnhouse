'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import ErrorUI from '@components/Objects/StyledElements/Error/Error'
import { useSearchParams, usePathname } from 'next/navigation'


export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const orgslug = searchParams.get('orgslug')

    // SSO callback doesn't need org context upfront - it gets org from state
    if (pathname?.startsWith('/auth/sso/')) {
        return <>{children}</>
    }

    if (orgslug) {
        return <OrgProvider orgslug={orgslug}>{children}</OrgProvider>
    } else {
        return <ErrorUI message='Organization not specified' submessage='Please access this page from an Organization' />
    }
}
