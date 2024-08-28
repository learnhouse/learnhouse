'use client'
import { OrgProvider } from '@components/Contexts/OrgContext'
import ErrorUI from '@components/StyledElements/Error/Error'
import { useParams } from 'next/navigation'


export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const params = useParams<{ orgslug: string; }>()
    const orgslug = params.orgslug
    if (orgslug) {
        return <OrgProvider orgslug={orgslug}>{children}</OrgProvider>
    } else {
        return <ErrorUI message='Organization not specified' submessage='Please access this page from an Organization' />
    }
}