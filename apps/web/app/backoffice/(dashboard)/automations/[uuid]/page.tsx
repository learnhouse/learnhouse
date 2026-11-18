import type { Metadata } from 'next'
import AutomationEditor from '@ee/components/Backoffice/Automations/AutomationEditor'

export const metadata: Metadata = {
  title: 'Automation',
}

export default async function BackofficeAutomationPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params
  return <AutomationEditor uuid={uuid} />
}
