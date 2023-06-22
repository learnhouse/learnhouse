import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { getCollectionByIdWithAuthHeader } from "@services/courses/collections";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

type MetadataProps = {
    params: { orgslug: string, courseid: string, collectionid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    const col = await getCollectionByIdWithAuthHeader(params.collectionid, access_token_cookie ? access_token_cookie.value : null, { revalidate: 0, tags: ['collections'] });
    
    console.log(col)

    return {
        title: `Collection : ${col.name}  — ${org.name}`,
        description: `${col.description} `,
    };
}

const CollectionPage = async (params : any) => {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    const orgslug = params.params.orgslug;
    const col = await getCollectionByIdWithAuthHeader(params.params.collectionid, access_token_cookie ? access_token_cookie.value : null, { revalidate: 0, tags: ['collections'] });

    const removeCoursePrefix = (courseid: string) => {
        return courseid.replace("course_", "")
    }


    return <GeneralWrapperStyled>
        <h2 className="text-sm font-bold text-gray-400">Collection</h2>
        <h1 className="text-3xl font-bold">{col.name}</h1>
        <br />
        <div className="home_courses flex flex-wrap">
          {col.courses.map((course: any) => (
            <div className="pr-8" key={course.course_id}>
              <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getBackendUrl()}content/uploads/img/${course.thumbnail})` }}>
                </div>
              </Link>
              <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
            </div>
          ))}
        </div>



    </GeneralWrapperStyled>;
};

export default CollectionPage;