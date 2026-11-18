import type { Metadata } from 'next'
import OrganizationsPage from '@ee/components/Backoffice/Organizations/OrganizationsPage'

export const metadata: Metadata = {
  title: 'Organizations',
}

export default function BackofficeOrganizationsPage() {
  return <OrganizationsPage />
}
