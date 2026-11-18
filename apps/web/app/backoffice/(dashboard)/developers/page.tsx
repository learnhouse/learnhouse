import type { Metadata } from 'next'
import DevelopersTabs from '@ee/components/Backoffice/Developers/DevelopersTabs'

export const metadata: Metadata = {
  title: 'Developers',
}

export default function BackofficeDevelopersPage() {
  return <DevelopersTabs />
}
