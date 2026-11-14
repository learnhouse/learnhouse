import type { Metadata } from 'next'
import TeamPage from '@components/Admin/Team/TeamPage'

export const metadata: Metadata = {
  title: 'Team',
}

export default function AdminTeamPage() {
  return <TeamPage />
}
