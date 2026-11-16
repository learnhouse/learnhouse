import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
// Plays are EE: without EE getPlayForLearner throws (the page 404s).
import { getPlayForLearner } from '@ee/services/plays/plays'
import PlaygroundViewClient from '@ee/components/Plays/Pages/PlaygroundViewPage'
import ResourcePaywall from '@ee/components/Payments/ResourcePaywall'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getOrganizationContextInfo } from '@services/organizations/orgs'

type PageParams = Promise<{ orgslug: string; playgrounduuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { playgrounduuid } = await params
  try {
    const pg = await getPlayForLearner(playgrounduuid)
    return {
      title: pg.name,
      description: pg.description || `Interactive play: ${pg.name}`,
    }
  } catch {
    return { title: 'Play' }
  }
}

export default async function PlaygroundViewPage({ params }: { params: PageParams }) {
  const { orgslug, playgrounduuid } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let playground
  try {
    // The learner read admits anonymous viewers, so public plays open from a
    // shared link without signing in (the main read requires a session).
    playground = await getPlayForLearner(playgrounduuid, access_token ?? undefined)
  } catch (error: any) {
    // Sold through a product the viewer has not bought: show what unlocks it.
    if (error?.status === 402) {
      const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
      const resourceUuid = playgrounduuid.startsWith('playground_') ? playgrounduuid : `playground_${playgrounduuid}`
      return (
        <GeneralWrapperStyled>
          <div className="max-w-2xl mx-auto pt-6">
            <ResourcePaywall orgId={org?.id} orgslug={orgslug} resourceUuid={resourceUuid}>{null}</ResourcePaywall>
          </div>
        </GeneralWrapperStyled>
      )
    }
    notFound()
  }

  if (!playground.published && !access_token) {
    notFound()
  }

  return (
    <PlaygroundViewClient playground={playground} orgslug={orgslug} />
  )
}
