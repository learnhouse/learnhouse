import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSlug } from '@services/org/orgResolution'
import VerifyEmailClient from './verify-email'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return { title: 'Verify Email — LearnHouse' }
  }

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 60,
      tags: ['organizations'],
    })
  } catch {
    // Stale cookie or unknown org — fall back to generic title
  }

  return {
    title: 'Verify Email' + ` — ${org?.name || 'LearnHouse'}`,
    robots: { index: false, follow: false },
  }
}

const VerifyEmailPage = async () => {
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return <OrgNotFound />
  }

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 60,
      tags: ['organizations'],
    })
  } catch {
    return <OrgNotFound />
  }

  if (!org) {
    return <OrgNotFound />
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <VerifyEmailClient org={org} />
    </Suspense>
  )
}

export default VerifyEmailPage
