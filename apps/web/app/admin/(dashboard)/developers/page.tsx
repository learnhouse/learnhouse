import type { Metadata } from 'next'
import DevelopersTabs from '@components/Admin/Developers/DevelopersTabs'

export const metadata: Metadata = {
  title: 'Developers',
}

export default function AdminDevelopersPage() {
  return <DevelopersTabs />
}
