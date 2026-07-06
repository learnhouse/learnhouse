import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import SignUpClient from './signup'
import { Suspense } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getAuthOrgSlug()

  if (!orgslug) {
    return { title: 'Sign up — LearnHouse' }
  }

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, null)
  } catch {
    // Stale cookie or unknown org — fall back to generic title
  }

  return {
    title: 'Sign up' + ` — ${org?.name || 'LearnHouse'}`,
    robots: { index: false, follow: false },
  }
}

const SignUp = async () => {
  const orgslug = await getAuthOrgSlug()

  // On the org-less apex (learn.io/signup) there is no subdomain org. We keep
  // `org` null so the page renders the generic, org-less open-signup form —
  // exactly like the apex login page. The account is still created against the
  // instance default org, but that is resolved server-side in the signup API so
  // the UI never shows an org here.
  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, null)
    } catch {
      org = null
    }
    // A missing subdomain org is a real 404.
    if (!org) {
      return <OrgNotFound />
    }
  }

  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <SignUpClient org={org} />
      </Suspense>
    </>
  )
}

export default SignUp
