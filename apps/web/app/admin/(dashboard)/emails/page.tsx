import type { Metadata } from 'next'
import EmailsPage from '@components/Admin/Emails/EmailsPage'

export const metadata: Metadata = {
  title: 'Emails',
}

export default function AdminEmailsPageRoute() {
  return <EmailsPage />
}
