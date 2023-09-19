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
import CourseThumbnail from '@components/Objects/Other/CourseThumbnail';
import CollectionThumbnail from '@components/Objects/Other/CollectionThumbnail';

type MetadataProps = {
  params: { orgslug: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
  { params }: MetadataProps,
): Promise<Metadata> {
  // Get Org context information 
  const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });

  // SEO
  return {
    title: `Home — ${org.name}`,
    description: org.description,
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
      title: `Home — ${org.name}`,
      description: org.description,
      type: 'website',
    },
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
              <CollectionThumbnail collection={collection} orgslug={orgslug} org_id={org.org_id} />
            </div>
          ))}
        </div>

        {/* Courses */}
        <div className='h-5'></div>
        <TypeOfContentTitle title="Courses" type="cou" />
        <div className="home_courses flex flex-wrap">
          {courses.map((course: any) => (
            <div className="py-3 px-3" key={course.course_id}>
              <CourseThumbnail course={course} orgslug={orgslug} />
            </div>
          ))}
        </div>
      </GeneralWrapperStyled>
    </div>

  );
};


export default OrgHomePage;
