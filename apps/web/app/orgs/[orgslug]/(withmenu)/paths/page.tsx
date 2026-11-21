import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getOrgOr404 } from '@/lib/org.server'
import PathsClient from './paths'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Paths', path: '/paths', description: `Learning paths from ${ctx.org?.name}`, keywords: undefined })
}

export default async function PathsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrgOr404(orgslug)

  return (
    <>
      <PathsClient orgslug={orgslug} org_id={org?.id || 0} />
    </>
  )
}
