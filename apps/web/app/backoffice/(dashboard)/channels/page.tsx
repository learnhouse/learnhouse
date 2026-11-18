import type { Metadata } from 'next'
import ChannelsPage from '@ee/components/Backoffice/Channels/ChannelsPage'

export const metadata: Metadata = {
  title: 'Channels',
}

export default function BackofficeChannelsPage() {
  return <ChannelsPage />
}
