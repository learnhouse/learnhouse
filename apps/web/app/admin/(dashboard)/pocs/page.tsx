import type { Metadata } from 'next'
import PocsPage from '@components/Admin/Pocs/PocsPage'

export const metadata: Metadata = {
  title: 'POCs',
}

export default function AdminPocsPage() {
  return <PocsPage />
}
