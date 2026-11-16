import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import WebsiteClient from './client'

type MetadataProps = { params: Promise<{ orgslug: string }> }

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 120, tags: ['organizations'] })
  return { title: 'Website | ' + org.name, robots: { index: false, follow: false } }
}

export default function WebsitePage() {
  return <WebsiteClient />
}
