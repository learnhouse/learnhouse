import type { Metadata } from 'next'
import AICostsPage from '@components/Admin/AICosts/AICostsPage'

export const metadata: Metadata = {
  title: 'AI costs',
}

export default function AdminAICostsPage() {
  return <AICostsPage />
}
