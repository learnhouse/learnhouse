import type { Metadata } from 'next'
import ActivityPage from '@ee/components/Backoffice/Activity/ActivityPage'

export const metadata: Metadata = {
  title: 'Activity',
}

export default function BackofficeActivityPage() {
  return <ActivityPage />
}
