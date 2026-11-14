import { Metadata } from 'next'
import { getLiveSession } from '@ee/services/live_sessions/live_sessions'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import { buildPageTitle } from '@/lib/seo/utils'
import LiveSessionPage from '@ee/components/LiveSessions/Pages/LiveSessionPage'

type PageParams = Promise<{ orgslug: string; sessionuuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, sessionuuid } = await params
  const ctx = await getSeoContext(orgslug)
  // Anonymous view: only public sessions are indexable (members-only ones stay noindex).
  const session = await getLiveSession(sessionuuid.startsWith('livesession_') ? sessionuuid : `livesession_${sessionuuid}`).catch(() => null)
  if (!session || session.access !== 'public') {
    return noindexMetadata(buildPageTitle('Live session', ctx.org?.name || 'Organization', ctx.seo))
  }
  return buildResourceMetadata({
    ctx,
    name: session.title,
    description: session.description || `Live session from ${ctx.org?.name}`,
    canonical: await ctx.url(`/live/${sessionuuid.replace(/^livesession_/, '')}`),
    indexable: session.status !== 'cancelled',
  })
}

export default async function Page({ params }: { params: PageParams }) {
  const { orgslug, sessionuuid } = await params
  return <LiveSessionPage orgslug={orgslug} sessionuuid={sessionuuid} />
}
