import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import ForgotPasswordClient from './forgot'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getAuthOrgSlug()

  if (!orgslug) {
    return { title: 'Forgot Password — LearnHouse' }
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
    title: 'Forgot Password' + ` — ${org?.name || 'LearnHouse'}`,
    robots: { index: false, follow: false },
  }
}

const ForgotPasswordPage = async () => {
  const orgslug = await getAuthOrgSlug()

  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, {
        revalidate: 60,
        tags: ['organizations'],
      })
    } catch {
      org = null
    }
    if (!org) {
      return <OrgNotFound />
    }
  }

  return <ForgotPasswordClient org={org} />
}

export default ForgotPasswordPage
