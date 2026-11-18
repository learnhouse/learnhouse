import type { Metadata } from 'next'
import DeletionsPage from '@ee/components/Backoffice/Deletions/DeletionsPage'

export const metadata: Metadata = {
  title: 'Deletions',
}

export default function BackofficeDeletionsPageRoute() {
  return <DeletionsPage />
}
