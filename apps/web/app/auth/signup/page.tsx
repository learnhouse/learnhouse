import PageLoading from '@components/Objects/Loaders/PageLoading'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import SignUpClient from './signup'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(
  params: MetadataProps
): Promise<Metadata> {
  const orgslug = (await params.searchParams).orgslug
  // Get Org context information
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  return {
    title: 'Sign up' + ` — ${org.name}`,
  }
}

const SignUp = async (params: any) => {
  const orgslug = (await params.searchParams).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <SignUpClient org={org} />
      </Suspense>
    </>
  )
}
export default SignUp
