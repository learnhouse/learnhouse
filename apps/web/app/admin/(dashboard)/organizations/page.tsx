import type { Metadata } from 'next'
import OrganizationsPage from '@components/Admin/Organizations/OrganizationsPage'

export const metadata: Metadata = {
  title: 'Organizations',
}

export default function AdminOrganizationsPage() {
  return <OrganizationsPage />
}
