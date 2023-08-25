export const dynamic = 'force-dynamic';
import { Metadata, ResolvingMetadata } from 'next';
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { getCourse, getOrgCourses, getOrgCoursesWithAuthHeader } from "@services/courses/courses";

import Link from "next/link";
import Image from "next/image";
import { getOrgCollections, getOrgCollectionsWithAuthHeader } from "@services/courses/collections";
import { getOrganizationContextInfo } from '@services/organizations/orgs';

import { cookies } from 'next/headers';
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper';
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from '@services/auth/auth';

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
    title: `Home — ${org.name}`,
    description: org.description,
  };
}

const OrgHomePage = async (params: any) => {
  const orgslug = params.params.orgslug;
  const cookieStore = cookies();

  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  const courses = await getOrgCoursesWithAuthHeader(orgslug, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null);
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] });
  const collections = await getOrgCollectionsWithAuthHeader(org.org_id, access_token ? access_token : null, { revalidate: 0, tags: ['courses'] });


  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }

  function removeCollectionPrefix(collection_id: string) {
    return collection_id.replace("collection_", "");
  }

  return (
    <div>
      <GeneralWrapperStyled>
        {/* Collections */}
        <TypeOfContentTitle title="Collections" type="col" />
        <div className="home_collections flex flex-wrap">
          {collections.map((collection: any) => (
            <div className="flex flex-col py-3 px-3" key={collection.collection_id}>
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

        {/* Courses */}
        <div className='h-5'></div>
        <TypeOfContentTitle title="Courses" type="cou" />
        <div className="home_courses flex flex-wrap">
          {courses.map((course: any) => (
            <div className="py-3 px-3" key={course.course_id}>
              <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover transition-all hover:scale-102" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(course.org_id, course.course_id, course.thumbnail)})` }}>
                </div>
              </Link>
              <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
            </div>
          ))}
        </div>
      </GeneralWrapperStyled>
    </div>

  );
};


export default OrgHomePage;
