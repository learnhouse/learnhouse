import type { Metadata } from 'next'
import AutomationEditor from '@components/Admin/Automations/AutomationEditor'

export const metadata: Metadata = {
  title: 'New automation',
}

export default function AdminNewAutomationPage() {
  return <AutomationEditor />
}
