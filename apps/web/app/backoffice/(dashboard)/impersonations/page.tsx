import type { Metadata } from 'next'
import ImpersonationsPage from '@ee/components/Backoffice/Impersonation/ImpersonationsPage'

export const metadata: Metadata = {
  title: 'Impersonations',
}

export default function BackofficeImpersonationsPageRoute() {
  return <ImpersonationsPage />
}
