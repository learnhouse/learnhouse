import type { Metadata } from 'next'
import AutomationEditor from '@ee/components/Backoffice/Automations/AutomationEditor'

export const metadata: Metadata = {
  title: 'New automation',
}

export default function BackofficeNewAutomationPage() {
  return <AutomationEditor />
}
