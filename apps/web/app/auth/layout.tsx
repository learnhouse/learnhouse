'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import ErrorUI from '@components/StyledElements/Error/Error'
import { useSearchParams } from 'next/navigation'


export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const searchParams = useSearchParams()
    const orgslug = searchParams.get('orgslug')
    if (orgslug) {
        return <OrgProvider orgslug={orgslug}>{children}</OrgProvider>
    } else {
        return <ErrorUI message='Organization not specified' submessage='Please access this page from an Organization' />
    }
}