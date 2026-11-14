import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getServerSession } from '@/lib/auth/server'
import { getCommunities } from '@services/communities/communities'
import CommunitiesClient from './communities'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await props.params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Communities', path: '/communities', description: ctx.seo.default_meta_description || `Discussion communities from ${ctx.org?.name}`, keywords: undefined })
}

const CommunitiesPage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  const [session, org] = await Promise.all([
    getServerSession(),
    getOrganizationContextInfo(orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    }),
  ])
  const access_token = session?.tokens?.access_token
  const org_id = org.id

  let communities = []
  try {
    communities = await getCommunities(
      org_id,
      1,
      100,
      { revalidate: 120, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch communities:', error)
    communities = []
  }


  return (
    <>
      <CommunitiesClient
        communities={communities || []}
        orgslug={orgslug}
        org_id={org_id}
      />
    </>
  )
}

export default CommunitiesPage
