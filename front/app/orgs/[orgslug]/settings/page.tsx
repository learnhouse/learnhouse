import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata, ResolvingMetadata } from 'next';

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
    title: `Settings — ${org.name}`,
    description: org.description,
  };
}

function Settings() {
  return (
    <div>Settings</div>
  )
}

export default Settings