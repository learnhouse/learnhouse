import AuthenticatedClientElement from "@components/Security/AuthenticatedClientElement";
import TypeOfContentTitle from "@components/StyledElements/Titles/TypeOfContentTitle";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { deleteCollection, getOrgCollectionsWithAuthHeader } from "@services/courses/collections";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";
import CollectionThumbnail from "@components/Objects/Other/CollectionThumbnail";

type MetadataProps = {
    params: { orgslug: string, courseid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });

    // SEO 
    return {
        title: `Collections — ${org.name}`,
        description: `Collections of courses from ${org.name}`,
        robots: {
            index: true,
            follow: true,
            nocache: true,
            googleBot: {
                index: true,
                follow: true,
                "max-image-preview": "large",
            }
        },
        openGraph: {
            title: `Collections — ${org.name}`,
            description: `Collections of courses from ${org.name}`,
            type: 'website',
        },
    };
}


const CollectionsPage = async (params: any) => {
    const cookieStore = cookies();
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
    const orgslug = params.params.orgslug;
    const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });
    const org_id = org.org_id;
    const collections = await getOrgCollectionsWithAuthHeader(org_id, access_token ? access_token : null, { revalidate: 0, tags: ['collections'] });

    return (
        <GeneralWrapperStyled>
            <div className="flex justify-between" >
                <TypeOfContentTitle title="Collections" type="col" />
                <AuthenticatedClientElement checkMethod='roles' orgId={org_id}>
                    <Link className="flex justify-center" href={getUriWithOrg(orgslug, "/collections/new")}>
                        <button className="rounded-md bg-black antialiased ring-offset-purple-800 p-2 px-5 my-auto font text-sm font-bold text-white drop-shadow-lg">Add Collection + </button>
                    </Link>
                </AuthenticatedClientElement>
            </div>
            <div className="home_collections flex flex-wrap">
                {collections.map((collection: any) => (
                    <div className="flex flex-col py-3 px-3" key={collection.collection_id}>
                        <CollectionThumbnail collection={collection} orgslug={orgslug} org_id={org_id} />
                    </div>
                ))}
            </div>
        </GeneralWrapperStyled>
    );
}

export default CollectionsPage