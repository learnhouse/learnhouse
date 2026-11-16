import type { Metadata } from 'next'
import DemoAccessPage from '@ee/app/demo/DemoAccessPage'

// Landing page of a demo instance's password-less sign-in link (EE).
export const metadata: Metadata = { title: 'Your demo', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default function Page() {
  return <DemoAccessPage />
}
