import type { Metadata } from 'next'
import ImpersonationsPage from '@components/Admin/Impersonation/ImpersonationsPage'

export const metadata: Metadata = {
  title: 'Impersonations',
}

export default function AdminImpersonationsPageRoute() {
  return <ImpersonationsPage />
}
