import { Metadata } from 'next'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import ConsentClient from './consent'

export const metadata: Metadata = {
  title: 'Connect an app | LearnHouse',
  robots: { index: false, follow: false },
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ConsentClient />
    </Suspense>
  )
}
