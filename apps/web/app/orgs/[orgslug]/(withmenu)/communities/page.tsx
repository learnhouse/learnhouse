import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getCommunities } from '@services/communities/communities'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import CommunitiesClient from './communities'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  return {
    title: `Communities — ${org.name}`,
    description: `Discussion communities from ${org.name}`,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    openGraph: {
      title: `Communities — ${org.name}`,
      description: `Discussion communities from ${org.name}`,
      type: 'website',
      images: [
        {
          url: getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
  }
}

const CommunitiesPage = async (params: any) => {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const org_id = org.id

  let communities = []
  try {
    communities = await getCommunities(
      org_id,
      1,
      100,
      { revalidate: 0, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch communities:', error)
    communities = []
  }

  return (
    <CommunitiesClient
      communities={communities || []}
      orgslug={orgslug}
      org_id={org_id}
    />
  )
}

export default CommunitiesPage
