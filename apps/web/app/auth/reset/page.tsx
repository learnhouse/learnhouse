import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSlug } from '@services/org/orgResolution'
import ResetPasswordClient from './reset'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return { title: 'Reset Password — LearnHouse' }
  }

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 60,
    tags: ['organizations'],
  })

  return {
    title: 'Reset Password' + ` — ${org?.name || 'LearnHouse'}`,
    robots: { index: false, follow: false },
  }
}

const ResetPasswordPage = async () => {
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return <OrgNotFound />
  }

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 60,
    tags: ['organizations'],
  })

  if (!org) {
    return <OrgNotFound />
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <ResetPasswordClient org={org} />
    </Suspense>
  )
}

export default ResetPasswordPage
