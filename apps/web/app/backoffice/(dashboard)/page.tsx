import type { Metadata } from 'next'
import OverviewPage from '@ee/components/Backoffice/Overview/OverviewPage'

export const metadata: Metadata = {
  title: 'Overview',
}

export default function BackofficeOverviewPage() {
  return <OverviewPage />
}
