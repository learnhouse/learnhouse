import type { Metadata } from 'next'
import AnalyticsPage from '@ee/components/Backoffice/Analytics/AnalyticsPage'

export const metadata: Metadata = {
  title: 'Analytics',
}

export default function BackofficeAnalyticsPage() {
  return <AnalyticsPage />
}
