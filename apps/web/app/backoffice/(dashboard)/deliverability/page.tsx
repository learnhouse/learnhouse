import type { Metadata } from 'next'
import DeliverabilityPage from '@ee/components/Backoffice/Deliverability/DeliverabilityPage'

export const metadata: Metadata = {
  title: 'Deliverability',
}

export default function BackofficeDeliverabilityPage() {
  return <DeliverabilityPage />
}
