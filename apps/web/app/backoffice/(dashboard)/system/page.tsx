import type { Metadata } from 'next'
import SystemPage from '@ee/components/Backoffice/System/SystemPage'

export const metadata: Metadata = {
  title: 'System',
}

export default function BackofficeSystemPage() {
  return <SystemPage />
}
