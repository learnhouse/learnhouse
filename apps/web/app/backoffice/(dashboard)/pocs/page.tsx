import type { Metadata } from 'next'
import PocsPage from '@ee/components/Backoffice/Pocs/PocsPage'

export const metadata: Metadata = {
  title: 'POCs',
}

export default function BackofficePocsPage() {
  return <PocsPage />
}
