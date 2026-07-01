import { Metadata } from 'next'
import { headers } from 'next/headers'
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
  let orgslug = await getAuthOrgSlug()
  let fromDefaultOrg = false

  // On the org-less apex (learn.io/signup) there is no subdomain org, but signup
  // still needs an org to create the account in. The proxy resolves the apex to
  // the instance default org and injects it as the `x-lh-org` request header
  // (available on the first cold visit, unlike the response-only cookie). Fall
  // back to it. If even that is missing we render the org-less open-signup form
  // (guarded in the client) rather than crashing.
  if (!orgslug) {
    const headerStore = await headers()
    orgslug = headerStore.get('x-lh-org') || null
    fromDefaultOrg = !!orgslug
  }

  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, null)
    } catch {
      org = null
    }
    // A missing subdomain org is a real 404; a missing default org on the apex
    // is not — just fall through to the org-less form.
    if (!org && !fromDefaultOrg) {
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
