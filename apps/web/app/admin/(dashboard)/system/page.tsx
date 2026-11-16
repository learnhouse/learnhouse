import type { Metadata } from 'next'
import SystemPage from '@components/Admin/System/SystemPage'

export const metadata: Metadata = {
  title: 'System',
}

export default function AdminSystemPage() {
  return <SystemPage />
}
