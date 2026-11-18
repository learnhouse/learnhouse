import type { Metadata } from 'next'
import EmailsPage from '@ee/components/Backoffice/Emails/EmailsPage'

export const metadata: Metadata = {
  title: 'Emails',
}

export default function BackofficeEmailsPageRoute() {
  return <EmailsPage />
}
