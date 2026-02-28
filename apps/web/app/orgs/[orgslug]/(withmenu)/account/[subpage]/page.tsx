import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import AccountClient from '@components/Objects/Account/AccountClient'
import { redirect } from 'next/navigation'

type MetadataProps = {
  params: Promise<{ orgslug: string; subpage: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const VALID_SUBPAGES = ['general', 'profile', 'security', 'purchases']

const getSubpageTitle = (subpage: string): string => {
  const titles: Record<string, string> = {
    'general': 'General Settings',
    'profile': 'Profile Builder',
    'security': 'Security',
    'purchases': 'Purchases',
  }
  return titles[subpage] || 'Account'
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  const title = `${getSubpageTitle(params.subpage)} — ${org.name}`
  const description = `Manage your account settings at ${org.name}`

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title,
      description,
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

const AccountSubPage = async (props: { params: Promise<{ orgslug: string; subpage: string }> }) => {
  const params = await props.params
  const session = await getServerSession()

  // Redirect to login if not authenticated
  if (!session) {
    redirect(`/${params.orgslug}`)
  }

  // Redirect to general if invalid subpage
  if (!VALID_SUBPAGES.includes(params.subpage)) {
    redirect(`/${params.orgslug}/account/general`)
  }

  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return (
    <AccountClient
      orgslug={params.orgslug}
      org_id={org.id}
      subpage={params.subpage}
    />
  )
}

export default AccountSubPage
