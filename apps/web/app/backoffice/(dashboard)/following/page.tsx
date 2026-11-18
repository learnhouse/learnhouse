import type { Metadata } from 'next'
import FollowingPage from '@ee/components/Backoffice/Following/FollowingPage'

export const metadata: Metadata = {
  title: 'Following',
}

export default function BackofficeFollowingPage() {
  return <FollowingPage />
}
