import type { Metadata } from 'next'
import DeletionsPage from '@components/Admin/Deletions/DeletionsPage'

export const metadata: Metadata = {
  title: 'Deletions',
}

export default function AdminDeletionsPageRoute() {
  return <DeletionsPage />
}
