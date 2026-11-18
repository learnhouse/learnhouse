import type { Metadata } from 'next'
import TeamPage from '@ee/components/Backoffice/Team/TeamPage'

export const metadata: Metadata = {
  title: 'Team',
}

export default function BackofficeTeamPage() {
  return <TeamPage />
}
