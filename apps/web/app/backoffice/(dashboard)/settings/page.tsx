import type { Metadata } from 'next'
import SettingsPage from '@ee/components/Backoffice/Settings/SettingsPage'

export const metadata: Metadata = {
  title: 'Platform settings',
}

export default function BackofficeSettingsPageRoute() {
  return <SettingsPage />
}
