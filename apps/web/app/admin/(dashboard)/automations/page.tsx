import type { Metadata } from 'next'
import AutomationsPage from '@components/Admin/Automations/AutomationsPage'

export const metadata: Metadata = {
  title: 'Automations',
}

export default function AdminAutomationsPage() {
  return <AutomationsPage />
}
