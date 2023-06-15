import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import PasswordsClient from "./passwords";

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
    title: `Settings: Passwords — ${org.name}`,
    description: org.description,
  };
}

function SettingsProfilePasswordsPage() {
  return (
    <>
      <PasswordsClient></PasswordsClient>
    </>
  )
}

export default SettingsProfilePasswordsPage