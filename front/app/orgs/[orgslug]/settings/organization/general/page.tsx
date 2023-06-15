import { getOrganizationContextInfo } from '@services/organizations/orgs';
import { Metadata } from 'next';
import OrganizationClient from './organization';

type MetadataProps = {
  params: { orgslug: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {

  // Get Org context information 
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
  return {
    title: `Settings: General — ${org.name}`,
    description: org.description,
  };
}

async function SettingsOrganizationGeneral(params: any) {
  const orgslug = params.params.orgslug;
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });

  return (
    <>
    <OrganizationClient org={org} />
    </>
  )
}

export default SettingsOrganizationGeneral