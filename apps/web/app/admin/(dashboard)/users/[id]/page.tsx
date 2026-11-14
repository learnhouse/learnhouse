'use client'
import { useParams } from 'next/navigation'
import UserDetailPage from '@components/Admin/Users/UserDetailPage'

export default function AdminUserDetailPage() {
  const params = useParams()
  return <UserDetailPage userId={String(params.id)} />
}
