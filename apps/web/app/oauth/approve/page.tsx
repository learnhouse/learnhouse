import { Metadata } from 'next'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import ApproveClient from './approve'

export const metadata: Metadata = {
  title: 'Approve an action | LearnHouse',
  robots: { index: false, follow: false },
}

export default function ApprovePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApproveClient />
    </Suspense>
  )
}
