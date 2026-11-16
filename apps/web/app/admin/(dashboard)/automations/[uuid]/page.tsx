import type { Metadata } from 'next'
import AutomationEditor from '@components/Admin/Automations/AutomationEditor'

export const metadata: Metadata = {
  title: 'Automation',
}

export default async function AdminAutomationPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params
  return <AutomationEditor uuid={uuid} />
}
