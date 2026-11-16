import type { Metadata } from 'next'
import OverviewPage from '@components/Admin/Overview/OverviewPage'

export const metadata: Metadata = {
  title: 'Overview',
}

export default function AdminOverviewPage() {
  return <OverviewPage />
}
