import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSlug } from '@services/org/orgResolution'
import LoginClient from './login'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getOrgSlug()

  if (!orgslug) {
    return { title: 'Login — LearnHouse' }
  }

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 60,
    tags: ['organizations'],
  })

  return {
    title: 'Login' + ` — ${org?.name || 'LearnHouse'}`,
  }
}

const Login = async () => {
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
    <div>
      <LoginClient org={org}></LoginClient>
    </div>
  )
}

export default Login
