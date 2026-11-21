import { Metadata } from 'next'
import { getOrgOr404 } from '@/lib/org.server'
import { getServerSession } from '@/lib/auth/server'
import PlaygroundsClient from '@ee/components/Plays/Pages/PlaysCatalogPage'
import { getOrgPlaygrounds } from '@ee/services/plays/playgrounds'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrgOr404(orgslug)
  return {
    title: `Plays | ${org?.name || 'Organization'}`,
    description: `Step-by-step interactive activities from ${org?.name || 'this organization'}`,
  }
}

export default async function PlaygroundsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const [session, org] = await Promise.all([
    getServerSession(),
    getOrgOr404(orgslug),
  ])
  const access_token = session?.tokens?.access_token

  let initialPlaygrounds: any[] = []
  try {
    if (org?.id) {
      initialPlaygrounds = await getOrgPlaygrounds(org.id, access_token ?? undefined)
    }
  } catch (error: any) {
    // 401/403: not visible to this viewer; the catalog shows its empty state.
    if (!(error?.status < 500)) console.error('Error fetching playgrounds:', error)
  }

  return (
    <PlaygroundsClient
      orgslug={orgslug}
      org_id={org?.id || 0}
      initialPlaygrounds={initialPlaygrounds}
    />
  )
}
