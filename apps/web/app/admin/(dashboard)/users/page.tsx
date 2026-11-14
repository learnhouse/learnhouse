import type { Metadata } from 'next'
import UsersPage from '@components/Admin/Users/UsersPage'

export const metadata: Metadata = {
  title: 'Users',
}

export default function AdminUsersPage() {
  return <UsersPage />
}
