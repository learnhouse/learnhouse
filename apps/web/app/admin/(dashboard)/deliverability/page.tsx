import type { Metadata } from 'next'
import DeliverabilityPage from '@components/Admin/Deliverability/DeliverabilityPage'

export const metadata: Metadata = {
  title: 'Deliverability',
}

export default function AdminDeliverabilityPage() {
  return <DeliverabilityPage />
}
