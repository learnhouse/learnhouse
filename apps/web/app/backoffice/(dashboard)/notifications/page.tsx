import type { Metadata } from 'next'
import NotificationsPage from '@ee/components/Backoffice/Notifications/NotificationsPage'

export const metadata: Metadata = {
  title: 'Notifications',
}

export default function BackofficeNotificationsPage() {
  return <NotificationsPage />
}
