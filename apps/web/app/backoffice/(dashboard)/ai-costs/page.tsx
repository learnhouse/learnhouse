import type { Metadata } from 'next'
import AICostsPage from '@ee/components/Backoffice/AICosts/AICostsPage'

export const metadata: Metadata = {
  title: 'AI costs',
}

export default function BackofficeAICostsPage() {
  return <AICostsPage />
}
