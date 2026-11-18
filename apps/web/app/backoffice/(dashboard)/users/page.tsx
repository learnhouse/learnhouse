import type { Metadata } from 'next'
import UsersPage from '@ee/components/Backoffice/Users/UsersPage'

export const metadata: Metadata = {
  title: 'Users',
}

export default function BackofficeUsersPage() {
  return <UsersPage />
}
