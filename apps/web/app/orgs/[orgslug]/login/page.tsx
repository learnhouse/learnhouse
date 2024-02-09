import { getOrganizationContextInfo } from "@services/organizations/orgs";
import LoginClient from "./login";
import { Metadata } from 'next';

type MetadataProps = {
  params: { orgslug: string, courseid: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  const orgslug = params.orgslug;
  // Get Org context information 
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 0, tags: ['organizations'] });

  return {
    title: 'Login' + ` — ${org.name}`,
  };
}

const Login = async (params: any) => {
  const orgslug = params.params.orgslug;
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 0, tags: ['organizations'] });

  return (
    <div>
      <LoginClient org={org}></LoginClient>
    </div>
  );
};



export default Login;
