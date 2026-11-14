import type { Metadata } from 'next'
import AnalyticsPage from '@components/Admin/Analytics/AnalyticsPage'

export const metadata: Metadata = {
  title: 'Analytics',
}

export default function AdminAnalyticsPage() {
  return <AnalyticsPage />
}
