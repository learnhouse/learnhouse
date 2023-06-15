import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import ProfileClient from "./profile";

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
        title: `Settings: Profile — ${org.name}`,
        description: org.description,
    };
}

function SettingsProfilePage() {
    return <ProfileClient></ProfileClient>
}

export default SettingsProfilePage