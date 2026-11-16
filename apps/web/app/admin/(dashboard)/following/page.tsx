import type { Metadata } from 'next'
import FollowingPage from '@components/Admin/Following/FollowingPage'

export const metadata: Metadata = {
  title: 'Following',
}

export default function AdminFollowingPage() {
  return <FollowingPage />
}
