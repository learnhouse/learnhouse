import type { Metadata } from 'next'
import DemoEndedPage from '@ee/app/demo/DemoEndedPage'

// Shown once a demo instance is closed or past its end (EE).
export const metadata: Metadata = { title: 'Demo ended', robots: { index: false, follow: false } }

export default function Page() {
  return <DemoEndedPage />
}
