import { getOrganizationContextInfo } from '@services/organizations/orgs'
import LoginClient from './login'
import { Metadata } from 'next'

type MetadataProps = {
  params: { orgslug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata(params: MetadataProps): Promise<Metadata> {
  const orgslug = params.searchParams.orgslug
  
  //const orgslug = params.orgslug
  // Get Org context information
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  return {
    title: 'Login' + ` — ${org.name}`,
  }
}

const Login = async (params: MetadataProps) => {
  const orgslug = params.searchParams.orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  return (
    <div>
      <LoginClient org={org}></LoginClient>
    </div>
  )
}

export default Login
