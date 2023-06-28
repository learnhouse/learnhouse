import AuthenticatedClientElement from "@components/Security/AuthenticatedClientElement";
import TypeOfContentTitle from "@components/StyledElements/Titles/TypeOfContentTitle";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { deleteCollection, getOrgCollectionsWithAuthHeader } from "@services/courses/collections";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import CollectionAdminEditsArea from "./admin";
import { getCourseThumbnailMediaDirectory } from "@services/media/media";

type MetadataProps = {
    params: { orgslug: string, courseid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    return {
        title: `Collections — ${org.name}`,
        description: `Collections of courses from ${org.name}`,
    };
}

const removeCollectionPrefix = (collectionid: string) => {
    return collectionid.replace("collection_", "")
}


const CollectionsPage = async (params: any) => {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    const orgslug = params.params.orgslug;
    const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });
    const org_id = org.org_id;
    const collections = await getOrgCollectionsWithAuthHeader(org_id, access_token_cookie ? access_token_cookie.value : null);

    return (
        <GeneralWrapperStyled>
            <div className="flex justify-between" >
                <TypeOfContentTitle title="Collections" type="col" />
                <AuthenticatedClientElement checkMethod='authentication'>
                    <Link className="flex justify-center" href={getUriWithOrg(orgslug, "/collections/new")}>
                        <button className="rounded-md bg-black antialiased ring-offset-purple-800 p-2 px-5 my-auto font text-sm font-bold text-white drop-shadow-lg">Add Collection + </button>
                    </Link>
                </AuthenticatedClientElement>
            </div>
            <div className="home_collections flex flex-wrap">
                {collections.map((collection: any) => (
                    <div className="flex flex-col py-3 px-3" key={collection.collection_id}>
                        <CollectionAdminEditsArea org_id={org_id} collection_id={collection.collection_id} collection={collection} />
                        <Link href={getUriWithOrg(orgslug, "/collection/" + removeCollectionPrefix(collection.collection_id))}>
                            <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[180px] bg-cover flex flex-col items-center justify-center bg-indigo-600 font-bold text-zinc-50" >
                                <h1 className="font-bold text-lg py-2 justify-center mb-2">{collection.name}</h1>
                                <div className="flex -space-x-4">
                                    {collection.courses.slice(0, 3).map((course: any) => (
                                        <Link key={course.course_id} href={getUriWithOrg(orgslug, "/course/" + course.course_id.substring(7))}>
                                            <img className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg ring-2 ring-white z-50" key={course.course_id} src={`${getCourseThumbnailMediaDirectory(course.org_id, course.course_id, course.thumbnail)}`} alt={course.name} />
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </Link>
                    </div>
                ))}
            </div>
        </GeneralWrapperStyled>
    );
}

export default CollectionsPage