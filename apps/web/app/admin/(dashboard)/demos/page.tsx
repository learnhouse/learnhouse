import type { Metadata } from 'next'
import DemosPage from '@ee/components/Demos/DemosPage'

export const metadata: Metadata = {
  title: 'Demos',
}

export default function AdminDemosPage() {
  return <DemosPage />
}
