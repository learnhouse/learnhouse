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

const VALID_SUBPAGES = ['general', 'profile', 'security', 'notifications', 'appearance', 'notes', 'purchases', 'ai-apps']

const getSubpageTitle = (subpage: string): string => {
  const titles: Record<string, string> = {
    'general': 'Profile',
    'profile': 'Profile',
    'security': 'Security',
    'notifications': 'Notifications',
    'appearance': 'Appearance',
    'notes': 'My notes',
    'purchases': 'Purchases',
    'ai-apps': 'AI apps',
  }
  return titles[subpage] || 'Account'
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  const title = `${getSubpageTitle(params.subpage)} | ${org.name}`
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

  // Browser-relative redirects only: the org slug is NEVER a URL path segment
  // (the proxy adds the /orgs/{slug} prefix). A slug-prefixed path would be
  // double-prefixed by the proxy → 404.
  if (!session) {
    redirect(`/login?redirect=/account/${params.subpage}`)
  }

  // Redirect to general if invalid subpage
  if (!VALID_SUBPAGES.includes(params.subpage)) {
    redirect('/account/general')
  }

  // The public profile builder is now the second sub-tab of the Profile
  // section; keep the old URL working (header menu, search, bookmarks).
  if (params.subpage === 'profile') {
    redirect('/account/general?section=public')
  }

  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
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
