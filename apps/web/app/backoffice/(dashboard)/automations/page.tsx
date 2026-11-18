import type { Metadata } from 'next'
import AutomationsPage from '@ee/components/Backoffice/Automations/AutomationsPage'

export const metadata: Metadata = {
  title: 'Automations',
}

export default function BackofficeAutomationsPage() {
  return <AutomationsPage />
}
