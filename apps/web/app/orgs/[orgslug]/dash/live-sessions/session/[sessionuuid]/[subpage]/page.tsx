import { Metadata } from 'next'
import LiveSessionManagePage from '@ee/components/LiveSessions/Pages/LiveSessionManagePage'

type Params = { orgslug: string; sessionuuid: string; subpage: string }

export const metadata: Metadata = {
  title: 'Live session',
  robots: { index: false, follow: false },
}

export default async function Page(props: { params: Promise<Params> }) {
  const params = await props.params
  return <LiveSessionManagePage {...params} />
}
