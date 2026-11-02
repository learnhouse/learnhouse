import { Metadata } from 'next'
import LiveRoomPage from '@ee/components/LiveSessions/Pages/LiveRoomPage'

type PageParams = Promise<{ orgslug: string; sessionuuid: string }>

export const metadata: Metadata = {
  title: 'Live session',
  robots: { index: false, follow: false },
}

export default async function Page({ params }: { params: PageParams }) {
  const { orgslug, sessionuuid } = await params
  return <LiveRoomPage orgslug={orgslug} sessionuuid={sessionuuid} />
}
