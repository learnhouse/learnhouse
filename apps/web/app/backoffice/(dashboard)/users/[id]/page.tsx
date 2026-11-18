'use client'
import { useParams } from 'next/navigation'
import UserDetailPage from '@ee/components/Backoffice/Users/UserDetailPage'

export default function BackofficeUserDetailPage() {
  const params = useParams()
  return <UserDetailPage userId={String(params.id)} />
}
