
import { Metadata } from "next";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import SignUpClient from "./signup";
import { Suspense } from "react";
import PageLoading from "@components/Objects/Loaders/PageLoading";

type MetadataProps = {
  params: { orgslug: string, courseid: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  const orgslug = params.orgslug;
  // Get Org context information 
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });

  return {
    title: 'Sign up' + ` — ${org.name}`,
  };
}

const SignUp = async (params: any) => {
  const orgslug = params.params.orgslug;
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });

  return (
    <>
      <Suspense fallback={<PageLoading/>}>
        <SignUpClient org={org} />
      </Suspense>
    </>
  );
};
export default SignUp;
