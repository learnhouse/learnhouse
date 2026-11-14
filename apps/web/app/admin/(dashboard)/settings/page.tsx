import type { Metadata } from 'next'
import SettingsPage from '@components/Admin/Settings/SettingsPage'

export const metadata: Metadata = {
  title: 'Platform settings',
}

export default function AdminSettingsPageRoute() {
  return <SettingsPage />
}
