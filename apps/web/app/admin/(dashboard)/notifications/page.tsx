import type { Metadata } from 'next'
import NotificationsPage from '@components/Admin/Notifications/NotificationsPage'

export const metadata: Metadata = {
  title: 'Notifications',
}

export default function AdminNotificationsPage() {
  return <NotificationsPage />
}
