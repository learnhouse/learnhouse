import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import PathCertificatePage from '@components/Pages/Paths/PathCertificatePage'

type PageParams = Promise<{ orgslug: string; uuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return {
    title: `Path certificate | ${org?.name}`,
    robots: { index: false, follow: false },
  }
}

export default async function Page({ params }: { params: PageParams }) {
  const { orgslug, uuid } = await params
  return <PathCertificatePage orgslug={orgslug} certificateUuid={uuid} />
}
